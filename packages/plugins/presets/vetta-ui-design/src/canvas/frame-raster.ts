import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BridgeHub } from "./bridge-client";
import { getFrameError } from "./design-runtime";
import { loadRasters, pruneRasters, saveRaster } from "./raster-cache";

/**
 * 空闲帧位图化 + 挂载节流。
 *
 * 画布上每个 frame 都是一个活的跨源 iframe，等于 N 套完整渲染树同时参与合成、
 * 还都套在画布的 scale 变换下。frame 一多，Chromium 的 tile 显存就不够用
 * （主进程日志里的 `tile memory limits exceeded, some content may not draw`），
 * 画不出来的部分被直接丢弃——这就是那种整窗口的撕裂闪烁。
 *
 * 两件事一起做：
 * 1. frame 渲染完成后截一张图，之后卸掉 iframe、改用位图显示。选中它、进入
 *    检查态、或它的代码变了时再换回活体。
 * 2. 启动时不一次性把所有 iframe 挂上去：同时活着的最多 MOUNT_WINDOW 个，
 *    截完一个放行下一个。否则「全部活着」的那几秒照样撑爆 tile 显存。
 */

/** 渲染信号到实际截图之间的静置时间：等字体、图片、布局都落定。 */
const SETTLE_MS = 450;
/**
 * 位图按设备像素比截。
 *
 * 曾经写死 1 倍，理由是「原尺寸位图在 100% 缩放下就是 1:1」——这漏掉了
 * devicePixelRatio：Retina 上 100% 缩放已经是 2 倍放大，画布再放大更糊，而旁边
 * 活体 iframe 是矢量渲染怎么放大都锐利，两态一对比就非常刺眼。
 *
 * 当初降到 1 倍是为了压内存（png dataUrl 一张好几 MB）。现在位图改用 jpeg 编码，
 * 同样像素数下字符串小一个量级，再配合下面的字节预算，2 倍的成本已经付得起。
 */
const RASTER_PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 2);
/** 画布位图的编码质量：肉眼看不出与 png 的差别，体积却只有零头。 */
const RASTER_JPEG_QUALITY = 0.92;
/**
 * 所有位图 dataUrl 的字符串总量上限。jpeg 下一张 390×844@2x 大约几百 KB，正常
 * 规模的设计稿远远够用；这只是防「几十上百帧」把内存吃穿的安全阀。触发淘汰后，
 * 被淘汰的 frame 会重新进入挂载窗口重截——真到那一步，反复重截就是它的代价。
 */
const RASTER_BUDGET_BYTES = 64 * 1024 * 1024;
/** 同时允许活体渲染的 frame 数上限。 */
const MOUNT_WINDOW = 2;

interface FrameRasterOptions {
	bridge: BridgeHub;
	/** 位图缓存的归属键（设计文档路径），见 raster-cache.ts。 */
	cacheKey: string;
	/** 画布上的 frame id，按画布顺序——决定谁先挂载、先截图。 */
	frameIds: readonly string[];
	/**
	 * 当前「在操作」的那个 frame，必须保持活体：检查态的，或单独选中的一个。
	 * 多选时不算——那是在排版而不是在看内容，全转活体会把合成压力又拉回来。
	 */
	activeFrameId: string | null;
}

export interface FrameRasterState {
	rasterOf(frameId: string): string | null;
	/** 该 frame 此刻是否需要挂上真正的 iframe。 */
	isMounted(frameId: string): boolean;
	/** 挂载之后是否显示活体（而不是位图）。截图失败的 frame 会留在活体，是安全兜底。 */
	isLive(frameId: string): boolean;
	/**
	 * 内容变了就作废旧位图，重新排队截图。调用方（DesignCanvas）在热更新到达、
	 * 文件监听发现源码变更、以及交互改了 frame 尺寸时调用。
	 */
	invalidate(frameId: string): void;
	/**
	 * 该 frame 本次挂载后已经把内容画上屏（bridge 的 rendered 信号）。截图队列以它
	 * 为放行条件：iframe 挂上后到首帧画出来之间可能有数秒（dev server 编译、React
	 * 首渲染），这期间截到的是空白/加载态。rendered 之前一律不截。
	 */
	notifyRendered(frameId: string): void;
	/**
	 * 在 frame 保证处于活体的前提下跑一段异步逻辑（截图必须这样做：display:none
	 * 的 iframe 没有布局，截出来是空的）。结束后恢复原状态。
	 */
	runLive<T>(frameId: string, run: () => Promise<T>): Promise<T>;
	/**
	 * 画布上任何一次 html-to-image 都要经过这里排队。
	 *
	 * 后台位图队列本来就是串行的（一次只截一张），但交付物那条路（vetd_screenshot、
	 * 导出、复制）走的是另一个入口，两边谁也不知道谁。而 agent 的固定节奏正好让它们
	 * 撞上：写完源码 → 文件监听让这一帧变脏、进队列等重截 → 紧接着就来截图。同一个
	 * iframe 上并行跑两遍 documentElement 的克隆与编码，互相拖慢远不止一倍，30s 也
	 * 打不住——超时报的还是「capture timed out」，看不出跟并发有关。
	 */
	withCaptureLock<T>(run: () => Promise<T>): Promise<T>;
	/**
	 * 把所有 frame 重新排队重截。共享资源（theme.css、components/*）改动时用它：
	 * 位图化的 frame 会重新挂载并加载新代码，还挂着的 frame 走 HMR，不打断检查态。
	 */
	refreshAll(): void;
	/**
	 * 顶部刷新按钮：在 refreshAll 之上，额外强制每个 iframe 重新导航。
	 *
	 * 只标脏是不够的——标脏只影响挂载窗口，此刻已经挂着的 iframe（选中的那个、还在
	 * 截图队列里的那些）DOM 节点不变、src 不变，浏览器不会重新加载，文档还是旧的。
	 * 这正是「刷新按钮点了没反应」。按钮是热更新失效时的兜底出路，必须真的重载。
	 */
	reloadAll(): void;
	/** reloadAll 自增，由 FrameView 拼进 iframe 的 URL 以触发重新导航。 */
	reloadNonce: number;
}

/**
 * 记下新位图，必要时按「最久没重截过」淘汰到预算内。Map 的迭代顺序就是写入顺序，
 * 拿它当近似 LRU 用；`keep` 里的（此刻挂着的、正在操作的）一律不动，淘汰它们只会
 * 立刻被重截。
 */
function withBudget(
	current: ReadonlyMap<string, string>,
	frameId: string,
	dataUrl: string,
	keep: ReadonlySet<string>,
): Map<string, string> {
	const next = new Map(current);
	// 先删再写：让这一帧回到队尾，否则老条目的位置会让它显得一直很「旧」。
	next.delete(frameId);
	next.set(frameId, dataUrl);
	let total = 0;
	for (const value of next.values()) total += value.length;
	if (total <= RASTER_BUDGET_BYTES) return next;
	for (const [id, value] of next) {
		if (total <= RASTER_BUDGET_BYTES) break;
		if (id === frameId || keep.has(id)) continue;
		next.delete(id);
		total -= value.length;
	}
	return next;
}

/**
 * 先把位图解码好再交给 React。
 *
 * 截图完成的那一刻 live 会翻成 false、iframe 收起、img 挂上——但一张还没解码的
 * img 是完全透明的，露出的是容器白底，也就是「切回位图时闪一下白」。这里提前把
 * 解码做掉（浏览器按 src 缓存解码结果），img 挂上就能直接画出来。
 * 解码失败不算错：交给 img 自己再试一次，大不了退回原来的行为。
 */
function decodeRaster(dataUrl: string): Promise<void> {
	const image = new Image();
	image.src = dataUrl;
	return image.decode().catch(() => undefined);
}

/** 等 React 提交 + 浏览器完成一次布局与绘制。 */
function nextPaint(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});
}

export function useFrameRasters({ bridge, cacheKey, frameIds, activeFrameId }: FrameRasterOptions): FrameRasterState {
	const [rasters, setRasters] = useState<ReadonlyMap<string, string>>(new Map());
	/** 等待截图的 frame：它们必须先保持活体，截完才收起。 */
	const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set());
	/** 被外部强制拉回活体的 frame（截图期间）。 */
	const [forced, setForced] = useState<ReadonlySet<string>>(new Set());
	/** frameId → 截图失败原因。用于把「优化没生效」这件事摆到台面上。 */
	const [failures, setFailures] = useState<ReadonlyMap<string, string>>(new Map());
	const capturingRef = useRef<string | null>(null);
	const timerRef = useRef<number | null>(null);
	/**
	 * 每个 frame 的失效代数。截图从静置到编码可达数秒，期间到达的 invalidate（agent
	 * 改代码 → HMR/文件监听）必须让这张「按旧内容截的图」作废重来；否则 finally 一清
	 * 脏标记，这次变更就永远丢了——位图停在旧版本，点进 frame 才发现对不上。
	 */
	const invalidationSeqRef = useRef<Map<string, number>>(new Map());
	/** 本次挂载后已收到 rendered 信号的 frame。iframe 卸载后作废（见 mounted 同步）。 */
	const renderedRef = useRef<Set<string>>(new Set());
	const [reloadNonce, setReloadNonce] = useState(0);
	const frameIdsRef = useRef(frameIds);
	frameIdsRef.current = frameIds;

	/**
	 * 冷启动：先把上一次的位图顶上，再把全部 frame 标脏让队列在后台逐个刷新。
	 *
	 * 恢复出来的位图可能是过期的——画布关着的时候 agent 照样能改代码——所以这里不是
	 * 「有缓存就不截了」，而是「先有画面，该截的一张不少」。正确性一分不让，省掉的是
	 * 那段所有 frame 一起转圈的干等。
	 *
	 * 依赖只有 cacheKey：frameIds 随视口重排，进了依赖会让缓存反复重读。切设计文档时
	 * 画布本来就整个卸载重建（CanvasTab 会先退回 preparing），所以 restoredKeyRef 主要
	 * 是防御——真出现同一实例换 key 的情况，也能把上一份的位图整个换掉而不是串图。
	 *
	 * 恢复不走 withBudget：帧数多到超预算时，第一张新位图落地就会把它收敛回去。
	 */
	const restoredKeyRef = useRef<string | null>(null);
	useEffect(() => {
		if (restoredKeyRef.current === cacheKey) return;
		restoredKeyRef.current = cacheKey;
		const ids = frameIdsRef.current;
		let cancelled = false;
		void loadRasters(cacheKey, ids).then((cached) => {
			if (cancelled) return;
			// 整个替换而不是合并：上一份设计的位图必须在这一步消失。
			setRasters(new Map(cached));
			setDirty(new Set(ids));
		});
		void pruneRasters(cacheKey, ids);
		return () => {
			cancelled = true;
		};
	}, [cacheKey]);

	/**
	 * 截图串行锁。链在一条 promise 上：拿到锁的那次跑完（无论成败）下一次才开始。
	 * 锁只保护「发 capture 到拿到结果」这一段——排队等待期间 frame 该挂着照样挂着。
	 */
	const captureLockRef = useRef<Promise<unknown>>(Promise.resolve());
	const withCaptureLock = useCallback(<T,>(run: () => Promise<T>): Promise<T> => {
		const next = captureLockRef.current.then(run, run);
		captureLockRef.current = next.catch(() => undefined);
		return next;
	}, []);

	const bumpSeq = useCallback((frameId: string): void => {
		invalidationSeqRef.current.set(frameId, (invalidationSeqRef.current.get(frameId) ?? 0) + 1);
	}, []);

	const invalidate = useCallback(
		(frameId: string): void => {
			bumpSeq(frameId);
			setDirty((current) => {
				if (current.has(frameId)) return current;
				const next = new Set(current);
				next.add(frameId);
				return next;
			});
		},
		[bumpSeq],
	);

	const notifyRendered = useCallback(
		(frameId: string): void => {
			renderedRef.current.add(frameId);
			bumpSeq(frameId);
			// 已经在脏集合里也要换个引用：rendered 门禁靠 ref 存放，不触发重渲染，
			// 全靠这次 state 变化让截图 effect 重跑、发现该 frame 现在可以截了。
			setDirty((current) => new Set(current).add(frameId));
		},
		[bumpSeq],
	);

	/** 截图失败的 frame 不自动重试（免得死循环烧 CPU），靠这里手动重来。 */
	const refreshAll = useCallback(
		(): void => {
			for (const frameId of frameIds) bumpSeq(frameId);
			setFailures(new Map());
			setDirty(new Set(frameIds));
		},
		[frameIds, bumpSeq],
	);

	const reloadAll = useCallback((): void => {
		refreshAll();
		setReloadNonce((current) => current + 1);
	}, [refreshAll]);

	/**
	 * 只有「还需要活体」的 frame 才挂 iframe：当前在操作的那个（选中/检查态）、
	 * 截图期间被强制拉活的、以及还没截到图的（含截图失败的，留活体是安全兜底）。
	 * 其余的 iframe 直接卸掉——留着 display:none 的 iframe 等于把 N 个完整 React
	 * 应用连同它们的大图一直留在内存里，tile 显存照样不够用。
	 *
	 * 卸载会丢掉 HMR 连接，所以源码变更改由画布侧的文件监听感知（见 DesignCanvas），
	 * 变更的 frame 会重新变脏 → 重新挂载 → 重新截图。
	 */
	const mounted = useMemo(() => {
		const allowed = new Set<string>();
		if (activeFrameId) allowed.add(activeFrameId);
		// 正在截图的那个必须留住。frameIds 的顺序跟着视口走（见 DesignCanvas），平移
		// 一下队列就重排，把它挤出挂载窗口会当场卸掉 iframe——这一张连同它已经等过的
		// SETTLE 一起白费，还要从头再来一遍。
		if (capturingRef.current) allowed.add(capturingRef.current);
		for (const frameId of forced) allowed.add(frameId);
		let budget = MOUNT_WINDOW;
		for (const frameId of frameIds) {
			if (allowed.has(frameId)) continue;
			if (!dirty.has(frameId) && rasters.has(frameId)) continue;
			if (budget <= 0) continue;
			allowed.add(frameId);
			budget -= 1;
		}
		return allowed;
	}, [frameIds, rasters, dirty, activeFrameId, forced]);

	// iframe 卸掉后 rendered 门禁作废：下次挂载是一次全新加载，要等新的 rendered。
	useEffect(() => {
		for (const frameId of renderedRef.current) {
			if (!mounted.has(frameId)) renderedRef.current.delete(frameId);
		}
	}, [mounted]);

	/**
	 * 一次只截一张：html-to-image 本身不便宜，并发截会把主线程占满。
	 *
	 * frameIds 会随视口重排（见 DesignCanvas），所以平移到新区域时这个 effect 会重跑、
	 * cleanup 把还在 SETTLE 等待中的那张作废重来。这是有意接受的：cullRect 带一屏预留
	 * 且余量不足半屏才重算，平移一屏才可能触发一次；而重排的意义正是「用户看向哪里就
	 * 先截哪里」，为省下一次 450ms 的等待去守住旧队列并不划算。已经进入 capture 阶段的
	 * 不受影响——那时 timerRef 已置空，cleanup 不动它，capturingRef 也拦着 effect 重排。
	 */
	useEffect(() => {
		if (capturingRef.current !== null) return;
		// 按 frameIds 而不是 dirty 的插入顺序取：dirty 是「谁先渲染完谁先进」，与视口
		// 优先级无关，眼前那几帧照样可能排在屏幕外的后面。
		//
		// 构建失败的 frame 此刻只剩兜底文案，截了会把「上一张好图」覆盖掉——正是出错时
		// 唯一还能看的东西。跳过它，保持活体，等它恢复渲染后重新排队。
		//
		// renderedRef 门禁：挂载到首帧画出来之间（dev server 编译、React 首渲染）截到的
		// 是空白/加载态。rendered 信号到达时 notifyRendered 会换 dirty 的引用触发本 effect
		// 重跑，所以这里跳过不会漏。
		const next = frameIds.find(
			(frameId) =>
				dirty.has(frameId) &&
				frameId !== activeFrameId &&
				mounted.has(frameId) &&
				renderedRef.current.has(frameId) &&
				!getFrameError(frameId),
		);
		if (next === undefined) return;

		capturingRef.current = next;
		// 此后到截图落地之间任何一次失效（invalidate / notifyRendered / refreshAll）都
		// 意味着这张图可能按旧内容截的，落地后必须重截。
		const seqAtStart = invalidationSeqRef.current.get(next) ?? 0;
		timerRef.current = window.setTimeout(() => {
			timerRef.current = null;
			void withCaptureLock(() =>
				bridge.capture(next, {
					pixelRatio: RASTER_PIXEL_RATIO,
					timeoutMs: 20_000,
					format: "jpeg",
					quality: RASTER_JPEG_QUALITY,
				}),
			)
				.then(async (dataUrl) => {
					// 解码在前、写状态在后：dirty 的清除在 finally，会等这个 await，
					// 所以位图进入 rasters 时一定是「挂上就能画」的。
					await decodeRaster(dataUrl);
					setRasters((current) => withBudget(current, next, dataUrl, mounted));
					// 落盘失败不影响这一轮（内存里已经有图），代价只是下次进画布得重截。
					void saveRaster(cacheKey, next, dataUrl);
				})
				.catch((error: unknown) => {
					// 截不到就让它继续活着——比显示一张坏图安全。但不能静默：一张都截
					// 不成时整块优化等于没生效，而表面上看不出任何区别。
					setFailures((current) =>
						new Map(current).set(next, error instanceof Error ? error.message : String(error)),
					);
					console.error(`[vetd] 位图化失败，frame 保持活体渲染: ${next}`, error);
				})
				.finally(() => {
					capturingRef.current = null;
					const stale = (invalidationSeqRef.current.get(next) ?? 0) !== seqAtStart;
					setDirty((current) => {
						if (!current.has(next)) return current;
						// 截图期间内容又变了：保留脏标记重新排队。换引用是必须的——effect
						// 在 capturingRef 占用期间的重跑都被拦掉了，只有这次 state 变化能
						// 让队列再动起来。
						if (stale) return new Set(current);
						const remaining = new Set(current);
						remaining.delete(next);
						return remaining;
					});
				});
		}, SETTLE_MS);

		return () => {
			if (timerRef.current !== null) {
				window.clearTimeout(timerRef.current);
				timerRef.current = null;
				capturingRef.current = null;
			}
		};
	}, [bridge, cacheKey, dirty, activeFrameId, mounted, frameIds, withCaptureLock]);

	const rasterOf = useCallback((frameId: string): string | null => rasters.get(frameId) ?? null, [rasters]);

	const isMounted = useCallback((frameId: string): boolean => mounted.has(frameId), [mounted]);

	const liveSet = useMemo(() => {
		const live = new Set<string>();
		for (const frameId of mounted) {
			if (frameId === activeFrameId || forced.has(frameId) || dirty.has(frameId) || !rasters.has(frameId)) {
				live.add(frameId);
			}
		}
		return live;
	}, [mounted, activeFrameId, forced, dirty, rasters]);

	const liveRef = useRef(liveSet);
	liveRef.current = liveSet;

	const isLive = useCallback((frameId: string): boolean => liveSet.has(frameId), [liveSet]);

	const runLive = useCallback(async <T,>(frameId: string, run: () => Promise<T>): Promise<T> => {
		// 本来就活着的话切过去只要一帧；如果它还没进过挂载窗口，iframe 是刚挂上的，
		// 得等它把页面加载渲染出来，否则截到的是白板。
		const wasLive = liveRef.current.has(frameId);
		setForced((current) => {
			const next = new Set(current);
			next.add(frameId);
			return next;
		});
		try {
			await nextPaint();
			if (!wasLive) await new Promise((resolve) => setTimeout(resolve, SETTLE_MS * 2));
			return await run();
		} finally {
			setForced((current) => {
				if (!current.has(frameId)) return current;
				const next = new Set(current);
				next.delete(frameId);
				return next;
			});
		}
	}, []);

	return {
		rasterOf,
		isMounted,
		isLive,
		invalidate,
		notifyRendered,
		runLive,
		withCaptureLock,
		refreshAll,
		reloadAll,
		reloadNonce,
	};
}
