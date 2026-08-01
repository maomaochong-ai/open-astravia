import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BridgeHub } from "./bridge-client";

/**
 * 空闲帧位图化 + 挂载节流。
 *
 * 画布上每个 frame 都是一个活的跨源 iframe，等于 N 套完整渲染树同时参与合成、
 * 还都套在画布的 scale 变换下。frame 一多，Chromium 的 tile 显存就不够用
 * （主进程日志里的 `tile memory limits exceeded, some content may not draw`），
 * 画不出来的部分被直接丢弃——这就是那种整窗口的撕裂闪烁。
 *
 * 两件事一起做：
 * 1. frame 渲染完成后截一张图，之后 iframe 收成 display:none、改用位图显示。
 *    双击进入检查、或代码热更新时再换回活体。
 * 2. 启动时不一次性把所有 iframe 挂上去：同时活着的最多 MOUNT_WINDOW 个，
 *    截完一个放行下一个。否则「全部活着」的那几秒照样撑爆 tile 显存。
 *
 * iframe 一旦挂上就不再卸载：卸载会丢掉 HMR 连接，frame 会永远停在旧位图上。
 * display:none 只停掉渲染与合成，文档与脚本照常活着。
 */

/** 渲染信号到实际截图之间的静置时间：等字体、图片、布局都落定。 */
const SETTLE_MS = 450;
/**
 * 位图按 1 倍截：frame 原尺寸的位图在 100% 缩放下就是 1:1，已经够清楚，而 2 倍
 * 会让每张图的解码内存翻四倍——七张 390×844 的图在 2 倍下就是三十多 MB，正是
 * tile 显存不够的一大来源。要看细节可以双击进入 frame，那时是真正的活体渲染。
 */
const RASTER_PIXEL_RATIO = 1;
/** 同时允许活体渲染的 frame 数上限。 */
const MOUNT_WINDOW = 2;

interface FrameRasterOptions {
	bridge: BridgeHub;
	/** 画布上的 frame id，按画布顺序——决定谁先挂载、先截图。 */
	frameIds: readonly string[];
	/** 当前处于检查态的 frame，必须保持活体。 */
	enteredFrameId: string | null;
}

export interface FrameRasterState {
	rasterOf(frameId: string): string | null;
	/** 该 frame 此刻是否需要挂上真正的 iframe。 */
	isMounted(frameId: string): boolean;
	/** 挂载之后是否显示活体（而不是位图）。截图失败的 frame 会留在活体，是安全兜底。 */
	isLive(frameId: string): boolean;
	/**
	 * 内容变了就作废旧位图，重新排队截图。调用方（DesignCanvas）在 frame 首次
	 * 渲染完成与热更新到达时各调一次——bridge 只有一套事件出口，统一在那里分发。
	 */
	invalidate(frameId: string): void;
	/**
	 * 在 frame 保证处于活体的前提下跑一段异步逻辑（截图必须这样做：display:none
	 * 的 iframe 没有布局，截出来是空的）。结束后恢复原状态。
	 */
	runLive<T>(frameId: string, run: () => Promise<T>): Promise<T>;
	/**
	 * 把所有 frame 重新排队：全部重新挂载、加载最新代码、渲染、重截。
	 * 供顶部的刷新按钮兜底——热更新链路万一没生效，用户有手动出路。
	 */
	refreshAll(): void;
}

/** 等 React 提交 + 浏览器完成一次布局与绘制。 */
function nextPaint(): Promise<void> {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});
}

export function useFrameRasters({ bridge, frameIds, enteredFrameId }: FrameRasterOptions): FrameRasterState {
	const [rasters, setRasters] = useState<ReadonlyMap<string, string>>(new Map());
	/** 等待截图的 frame：它们必须先保持活体，截完才收起。 */
	const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set());
	/** 被外部强制拉回活体的 frame（截图期间）。 */
	const [forced, setForced] = useState<ReadonlySet<string>>(new Set());
	/** frameId → 截图失败原因。用于把「优化没生效」这件事摆到台面上。 */
	const [failures, setFailures] = useState<ReadonlyMap<string, string>>(new Map());
	const capturingRef = useRef<string | null>(null);
	const timerRef = useRef<number | null>(null);

	const invalidate = useCallback((frameId: string): void => {
		setDirty((current) => {
			if (current.has(frameId)) return current;
			const next = new Set(current);
			next.add(frameId);
			return next;
		});
	}, []);

	/** 截图失败的 frame 不自动重试（免得死循环烧 CPU），靠这里手动重来。 */
	const refreshAll = useCallback((): void => {
		setFailures(new Map());
		setDirty(new Set(frameIds));
	}, [frameIds]);

	/**
	 * 只有「还需要活体」的 frame 才挂 iframe：检查态、截图期间被强制拉活的、
	 * 以及还没截到图的（含截图失败的，留活体是安全兜底）。截到图之后 iframe 直接
	 * 卸掉——留着 display:none 的 iframe 等于把 N 个完整 React 应用连同它们的大图
	 * 一直留在内存里，tile 显存照样不够用。
	 *
	 * 卸载会丢掉 HMR 连接，所以源码变更改由画布侧的文件监听感知（见 DesignCanvas），
	 * 变更的 frame 会重新变脏 → 重新挂载 → 重新截图。
	 */
	const mounted = useMemo(() => {
		const allowed = new Set<string>();
		if (enteredFrameId) allowed.add(enteredFrameId);
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
	}, [frameIds, rasters, dirty, enteredFrameId, forced]);

	// 一次只截一张：html-to-image 本身不便宜，并发截会把主线程占满。
	useEffect(() => {
		if (capturingRef.current !== null) return;
		const next = [...dirty].find((frameId) => frameId !== enteredFrameId && mounted.has(frameId));
		if (next === undefined) return;

		capturingRef.current = next;
		timerRef.current = window.setTimeout(() => {
			timerRef.current = null;
			void bridge
				.capture(next, { pixelRatio: RASTER_PIXEL_RATIO, timeoutMs: 20_000 })
				.then((dataUrl) => {
					setRasters((current) => new Map(current).set(next, dataUrl));
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
					setDirty((current) => {
						if (!current.has(next)) return current;
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
	}, [bridge, dirty, enteredFrameId, mounted]);

	const rasterOf = useCallback((frameId: string): string | null => rasters.get(frameId) ?? null, [rasters]);

	const isMounted = useCallback((frameId: string): boolean => mounted.has(frameId), [mounted]);

	const liveSet = useMemo(() => {
		const live = new Set<string>();
		for (const frameId of mounted) {
			if (frameId === enteredFrameId || forced.has(frameId) || dirty.has(frameId) || !rasters.has(frameId)) {
				live.add(frameId);
			}
		}
		return live;
	}, [mounted, enteredFrameId, forced, dirty, rasters]);

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
		runLive,
		refreshAll,
	};
}
