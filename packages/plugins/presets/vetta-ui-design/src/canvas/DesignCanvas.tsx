import { useTranslation } from "@vetta-org/plugin-sdk";
import {
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { getPluginCtx, notify } from "../plugin-context";
import type { DesignSession } from "../vetd/design-session";
import type { VetdFrameEntry, VetdManifest } from "../vetd/manifest-types";
import { type AskShot, buildAskPrompt } from "./ask-vetta";
import { AskVettaButton } from "./AskVettaButton";
import { AskVettaPopover } from "./AskVettaPopover";
import { BridgeHub, type SelectedElementPayload } from "./bridge-client";
import { ConfirmDialog } from "./ConfirmDialog";
import { ControlBar, type CanvasTool } from "./ControlBar";
import {
	type FrameActivity,
	notifyFrameSettled,
	onFrameActivity,
	requestMockupExport,
} from "./design-runtime";
import { type FrameMenuAnchor, FrameContextMenu } from "./FrameContextMenu";
import { useFrameRasters } from "./frame-raster";
import { FrameView } from "./FrameView";

export type CanvasSelection =
	| { kind: "frames"; ids: string[] }
	| { kind: "dom"; frameId: string; payload: SelectedElementPayload }
	| null;

/** agent 侧截图入口，见 {@link DesignCanvasProps.captureRef}。 */
export type FrameCapture = (frameId: string) => Promise<string>;

interface DesignCanvasProps {
	session: DesignSession;
	port: number;
	bridge: BridgeHub;
	/**
	 * 出口：把「先拉回活体再截」的截图函数交给 CanvasTab，vetd_screenshot 用它。
	 * runLive 来自 useFrameRasters，只存在于本组件里；外层若直接调 bridge.capture，
	 * 位图态（display:none）的 frame 截不出任何东西，只会卡到超时。
	 */
	captureRef: RefObject<FrameCapture | null>;
	/**
	 * 出口：顶部的刷新按钮用它强制所有 frame 重新加载并重截位图。
	 * 热更新链路（文件监听 / HMR）万一没生效时的手动兜底。
	 */
	refreshRef: RefObject<(() => void) | null>;
}

interface Viewport {
	x: number;
	y: number;
	zoom: number;
}

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.2;
/** Below this the marquee counts as a click, not a drag. */
const MARQUEE_MIN = 4;
/** sidecar 里的生成物，不参与「源码变了要重截」的判断。 */
const GENERATED_PREFIXES = [".snapshots/", ".vetd-build/", "node_modules/"];
/** 右键「复制为图片」的截图倍率：粘到聊天/文档里要经得起看，1 倍太糊。 */
const COPY_PIXEL_RATIO = 2;

function clampZoom(zoom: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Frames the current selection covers — a DOM selection counts as its frame. */
function selectedFrameIds(selection: CanvasSelection): string[] {
	if (!selection) return [];
	return selection.kind === "frames" ? selection.ids : [selection.frameId];
}

function intersects(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Canvas reading order: left to right, top to bottom for equal x. */
function byCanvasOrder(a: VetdFrameEntry, b: VetdFrameEntry): number {
	return a.x === b.x ? a.y - b.y : a.x - b.x;
}

export function DesignCanvas({ session, port, bridge, captureRef, refreshRef }: DesignCanvasProps) {
	const { t } = useTranslation();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [manifest, setManifest] = useState<VetdManifest>(session.manifest);
	const [viewport, setViewport] = useState<Viewport>(() => ({ ...session.manifest.canvas }));
	const viewportRef = useRef(viewport);
	viewportRef.current = viewport;
	const [tool, setTool] = useState<CanvasTool>("select");
	const [spaceHeld, setSpaceHeld] = useState(false);
	const [selection, setSelection] = useState<CanvasSelection>(null);
	const selectionRef = useRef(selection);
	selectionRef.current = selection;
	const [enteredFrameId, setEnteredFrameId] = useState<string | null>(null);
	const [activity, setActivity] = useState<ReadonlyMap<string, FrameActivity>>(new Map());
	const [marquee, setMarquee] = useState<Rect | null>(null);
	const [askOpen, setAskOpen] = useState(false);
	const [askBusy, setAskBusy] = useState(false);
	const [menuAnchor, setMenuAnchor] = useState<FrameMenuAnchor | null>(null);
	/** 正在就地重命名的 frame id（标题栏变输入框）。 */
	const [renamingId, setRenamingId] = useState<string | null>(null);
	/** 待确认删除的 frame id，非 null 时显示二次确认。 */
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [moveDelta, setMoveDelta] = useState<{ dx: number; dy: number } | null>(null);
	const panRef = useRef<{ pointerId: number; startX: number; startY: number; origin: Viewport } | null>(null);
	const marqueeRef = useRef<{ pointerId: number; startX: number; startY: number; mode: "create" | "select" } | null>(
		null,
	);
	const moveRef = useRef<{ origins: Map<string, { x: number; y: number }> } | null>(null);
	/** 平移进行中的实时视口。非 null 时 DOM 上的 transform 由它驱动，state 落后一步。 */
	const panLiveRef = useRef<Viewport | null>(null);
	const rafRef = useRef<number | null>(null);
	const wheelSettleRef = useRef<number | null>(null);
	const worldRef = useRef<HTMLDivElement | null>(null);

	const paintViewport = useCallback((next: Viewport): void => {
		const world = worldRef.current;
		if (world) world.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`;
	}, []);

	/** 把高频 pointermove 折叠到每帧一次实际绘制。 */
	const schedulePaint = useCallback((): void => {
		if (rafRef.current !== null) return;
		rafRef.current = window.requestAnimationFrame(() => {
			rafRef.current = null;
			if (panLiveRef.current) paintViewport(panLiveRef.current);
		});
	}, [paintViewport]);

	// 平移途中若因别的原因（manifest 变化、活动态更新）触发了渲染，React 会用落后
	// 的 state 覆盖 transform 把画布弹回去；这里在提交后、绘制前再抹一次实时值。
	useLayoutEffect(() => {
		if (panLiveRef.current) paintViewport(panLiveRef.current);
	});

	useEffect(
		() => () => {
			if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
		},
		[],
	);

	useEffect(() => {
		const handle = session.on((change) => {
			if (change === "frames") setManifest({ ...session.manifest });
		});
		setManifest({ ...session.manifest });
		return () => handle.dispose();
	}, [session]);

	useEffect(() => onFrameActivity((next) => setActivity(new Map(next))), []);


	/**
	 * 「在操作」的那个 frame 保持活体：单独选中一个就够，不必双击进检查态——
	 * 选中通常就是要看它的真实渲染。多选不算，那是在排版，全转活体会把合成压力
	 * 又拉回来。
	 */
	const activeFrameId = useMemo(() => {
		if (enteredFrameId) return enteredFrameId;
		const ids = selectedFrameIds(selection);
		return ids.length === 1 ? ids[0] : null;
	}, [enteredFrameId, selection]);

	// 空闲 frame 用位图代替活体 iframe，画布上就不再有 N 套渲染树同时合成。
	const orderedFrameIds = useMemo(
		() => [...manifest.frames].sort(byCanvasOrder).map((frame) => frame.id),
		[manifest.frames],
	);
	const {
		rasterOf,
		isMounted,
		isLive,
		invalidate: invalidateRaster,
		runLive,
		refreshAll,
	} = useFrameRasters({ bridge, frameIds: orderedFrameIds, activeFrameId });

	refreshRef.current = refreshAll;

	/**
	 * 位图化后 iframe 会被卸掉，也就收不到 HMR 了；agent 改完代码画布必须自己发现。
	 *
	 * 宿主的目录监听回调拿不到具体文件——它广播的是**被监听目录**的路径，而且所有
	 * 监听共用同一个事件，所以既要按路径过滤，也没法直接知道是哪个 frame 变了。
	 * 这里改成收到通知后比对各 frame 源码的 mtime，变了的才作废位图：它会重新
	 * 挂载、加载新代码、渲染、重新截图。外部编辑器改的也一样能感知。
	 */
	const sourceMtimesRef = useRef<Map<string, number>>(new Map());
	useEffect(() => {
		const ctx = getPluginCtx();
		const root = session.dirPath;
		let disposed = false;
		const handles: { dispose(): void }[] = [];

		const rescan = async (seedOnly: boolean): Promise<void> => {
			const files = await ctx.fs.listFilesRecursive(root).catch(() => []);
			const changedFrames = new Set<string>();
			let sharedChanged = false;

			for (const file of files) {
				if (disposed) return;
				const rel = file.relPath.replaceAll("\\", "/");
				if (GENERATED_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
				const stat = await ctx.fs.stat(file.path).catch(() => null);
				if (!stat) continue;
				const previous = sourceMtimesRef.current.get(rel);
				sourceMtimesRef.current.set(rel, stat.modifiedAt);
				if (seedOnly || previous === undefined || previous === stat.modifiedAt) continue;
				const frameMatch = /^frames\/(.+)\.tsx$/.exec(rel);
				// frame 自己的源码只影响它自己；theme.css、components/*、assets/* 这类
				// 共享资源改一下可能影响任意 frame，无从判断依赖关系，只能全部重截。
				if (frameMatch) changedFrames.add(frameMatch[1]);
				else sharedChanged = true;
			}

			if (disposed) return;
			if (sharedChanged) refreshAll();
			else for (const frameId of changedFrames) invalidateRaster(frameId);
		};

		void (async () => {
			// 先建立基线，否则第一次通知会把所有文件都判成「变了」。
			await rescan(true);
			if (disposed) return;
			// fs.watch 没开 recursive，只能收到目录直属文件的变动：根目录管
			// theme.css，子目录各自管自己的（frames/、components/、assets/…）。
			const entries = await ctx.fs.readDir(root).catch(() => []);
			const dirs = [
				root,
				...entries
					.filter((entry) => entry.isDirectory && !GENERATED_PREFIXES.some((p) => `${entry.name}/` === p))
					.map((entry) => entry.path),
			];
			if (disposed) return;
			for (const dir of dirs) {
				// onDirChanged 是全局事件、所有监听共用，且宿主回传的是被监听目录
				// 本身的绝对路径（不是变更文件），所以只能靠它筛掉别处的通知。
				handles.push(ctx.fs.watchDirectory(dir, (changedDir) => {
					if (dirs.some((watched) => watched === changedDir)) void rescan(false);
				}));
			}
		})();

		return () => {
			disposed = true;
			for (const handle of handles) handle.dispose();
		};
	}, [session, invalidateRaster, refreshAll]);

	const exitInspect = useCallback(
		(frameId: string | null) => {
			if (frameId) bridge.setMode(frameId, "off");
			setEnteredFrameId(null);
		},
		[bridge],
	);

	// 切到托手工具：清空选中（含 DOM 选中态），托手期间不产生任何选中。
	useEffect(() => {
		if (tool !== "hand") return;
		setEnteredFrameId((entered) => {
			if (entered) bridge.setMode(entered, "off");
			return null;
		});
		setSelection(null);
	}, [tool, bridge]);

	useEffect(() => {
		bridge.start({
			onSelected: (frameId, payload) => {
				setSelection(payload ? { kind: "dom", frameId, payload } : { kind: "frames", ids: [frameId] });
			},
			onExitInspect: (frameId) => {
				exitInspect(frameId);
				setSelection({ kind: "frames", ids: [frameId] });
			},
			onHmrUpdated: (frameId) => {
				notifyFrameSettled(frameId);
				if (frameId) invalidateRaster(frameId);
			},
			onRendered: invalidateRaster,
		});
		return () => bridge.stop();
	}, [bridge, exitInspect, invalidateRaster]);

	/** Click / shift-click a frame. Shift toggles membership; a plain click replaces. */
	const selectFrame = useCallback((frameId: string, additive: boolean): void => {
		setSelection((current) => {
			if (!additive) return { kind: "frames", ids: [frameId] };
			const base = current ? (current.kind === "frames" ? current.ids : [current.frameId]) : [];
			if (!base.includes(frameId)) return { kind: "frames", ids: [...base, frameId] };
			const next = base.filter((id) => id !== frameId);
			return next.length > 0 ? { kind: "frames", ids: next } : null;
		});
	}, []);

	/**
	 * 右击 frame 弹菜单。菜单里的动作（让 Vetta 调整 / 导出渲染图）按当前选中执行，
	 * 所以右击一个没选中的 frame 要先把它选上——否则动作会落在别处，或者无从执行。
	 * 已在选中集合里的则保持原选中（含 DOM 选中态），多选右击不打散分组。
	 */
	const openFrameMenu = useCallback(
		(frameId: string, clientX: number, clientY: number): void => {
			containerRef.current?.focus();
			if (enteredFrameId && enteredFrameId !== frameId) exitInspect(enteredFrameId);
			setSelection((current) =>
				selectedFrameIds(current).includes(frameId) ? current : { kind: "frames", ids: [frameId] },
			);
			setAskOpen(false);
			const bounds = containerRef.current?.getBoundingClientRect();
			setMenuAnchor({ frameId, x: clientX - (bounds?.left ?? 0), y: clientY - (bounds?.top ?? 0) });
		},
		[enteredFrameId, exitInspect],
	);

	// Space → temporary hand tool; Esc at canvas level clears selection.
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const onKeyDown = (event: KeyboardEvent): void => {
			// 画布里的输入框（重命名、让 Vetta 调整）也在这个容器内，事件会冒泡上来。
			// 不放行的话空格会被 preventDefault 掉（打不出空格），Esc 也会顺带清空选中。
			const target = event.target as HTMLElement | null;
			if (target && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
				return;
			}
			if (event.code === "Space" && !event.repeat) {
				event.preventDefault();
				setSpaceHeld(true);
			} else if (event.key === "Escape") {
				if (enteredFrameId) {
					exitInspect(enteredFrameId);
					setSelection({ kind: "frames", ids: [enteredFrameId] });
				} else {
					setSelection(null);
				}
			}
		};
		const onKeyUp = (event: KeyboardEvent): void => {
			if (event.code === "Space") setSpaceHeld(false);
		};
		container.addEventListener("keydown", onKeyDown);
		container.addEventListener("keyup", onKeyUp);
		return () => {
			container.removeEventListener("keydown", onKeyDown);
			container.removeEventListener("keyup", onKeyUp);
		};
	}, [enteredFrameId, exitInspect]);

	// Ctrl/⌘ + wheel → stepless zoom around the cursor; plain wheel → pan.
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const onWheel = (event: WheelEvent): void => {
			event.preventDefault();
			const bounds = container.getBoundingClientRect();
			const current = viewportRef.current;
			if (event.ctrlKey || event.metaKey) {
				const cursorX = event.clientX - bounds.left;
				const cursorY = event.clientY - bounds.top;
				const nextZoom = clampZoom(current.zoom * Math.exp(-event.deltaY * 0.01));
				const scale = nextZoom / current.zoom;
				const next = {
					zoom: nextZoom,
					x: cursorX - (cursorX - current.x) * scale,
					y: cursorY - (cursorY - current.y) * scale,
				};
				// 缩放要重渲染（frame 标题与手柄按 zoom 反向缩放），走 state。
				// 先撤掉可能还挂着的滚轮平移实时值，否则 layout effect 会拿旧位置盖回去。
				panLiveRef.current = null;
				if (wheelSettleRef.current !== null) {
					window.clearTimeout(wheelSettleRef.current);
					wheelSettleRef.current = null;
				}
				setViewport(next);
				session.saveViewport(next);
			} else {
				// 滚轮平移与托手拖拽同理：走 DOM，不逐事件进 state（触控板两指平移
				// 同样高频）。停下来一小会儿再落 state 与磁盘。
				const next = { ...current, x: current.x - event.deltaX, y: current.y - event.deltaY };
				viewportRef.current = next;
				panLiveRef.current = next;
				schedulePaint();
				if (wheelSettleRef.current !== null) window.clearTimeout(wheelSettleRef.current);
				wheelSettleRef.current = window.setTimeout(() => {
					wheelSettleRef.current = null;
					const settled = panLiveRef.current;
					if (!settled || panRef.current) return;
					panLiveRef.current = null;
					setViewport(settled);
					session.saveViewport(settled);
				}, 140);
			}
		};
		container.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			container.removeEventListener("wheel", onWheel);
			if (wheelSettleRef.current !== null) window.clearTimeout(wheelSettleRef.current);
		};
	}, [session, schedulePaint]);

	const toWorld = useCallback((clientX: number, clientY: number) => {
		const bounds = containerRef.current?.getBoundingClientRect();
		const current = viewportRef.current;
		const localX = clientX - (bounds?.left ?? 0);
		const localY = clientY - (bounds?.top ?? 0);
		return { x: (localX - current.x) / current.zoom, y: (localY - current.y) / current.zoom };
	}, []);

	const panActive = tool === "hand" || spaceHeld;

	// 切到托手（或按住空格）就是要平移画布，右键菜单与重命名编辑态都该让位。
	useEffect(() => {
		if (!panActive) return;
		setMenuAnchor(null);
		setRenamingId(null);
	}, [panActive]);

	const onBackgroundPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
		containerRef.current?.focus();
		// 右键交给上下文菜单（空白处则什么都不做），别捕获指针起手平移/框选。
		if (event.button !== 0) return;
		if (panActive) {
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
			panRef.current = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				origin: viewportRef.current,
			};
			return;
		}
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		marqueeRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			mode: tool === "frame" ? "create" : "select",
		};
		const world = toWorld(event.clientX, event.clientY);
		setMarquee({ x: world.x, y: world.y, width: 0, height: 0 });
		// Select tool on empty canvas: drop the current selection unless extending it.
		if (tool !== "frame" && !event.shiftKey) {
			if (enteredFrameId) exitInspect(enteredFrameId);
			setSelection(null);
		}
	};

	const onBackgroundPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
		const pan = panRef.current;
		if (pan && event.pointerId === pan.pointerId) {
			const next = {
				...pan.origin,
				x: pan.origin.x + (event.clientX - pan.startX),
				y: pan.origin.y + (event.clientY - pan.startY),
			};
			// 平移只改外层那一个 transform，不进 state：过 React 的话每个 pointermove
			// 都要重渲染整棵 frame 子树（每个 frame 一个跨源 iframe），指针事件又是
			// 高频且会合并投递，于是渲染把合成器饿死，整窗口高频闪烁。
			viewportRef.current = next;
			panLiveRef.current = next;
			schedulePaint();
			return;
		}
		const mq = marqueeRef.current;
		if (mq && event.pointerId === mq.pointerId) {
			const start = toWorld(mq.startX, mq.startY);
			const now = toWorld(event.clientX, event.clientY);
			setMarquee({
				x: Math.min(start.x, now.x),
				y: Math.min(start.y, now.y),
				width: Math.abs(now.x - start.x),
				height: Math.abs(now.y - start.y),
			});
		}
	};

	const onBackgroundPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (panRef.current && event.pointerId === panRef.current.pointerId) {
			panRef.current = null;
			if (rafRef.current !== null) {
				window.cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
			// 松手才把这一趟平移交回 state：期间 DOM 已经是最终位置，这次渲染不会跳。
			const settled = panLiveRef.current ?? viewportRef.current;
			panLiveRef.current = null;
			setViewport(settled);
			session.saveViewport(settled);
			return;
		}
		const mq = marqueeRef.current;
		if (!mq || event.pointerId !== mq.pointerId) return;
		marqueeRef.current = null;
		const rect = marquee;
		setMarquee(null);
		if (!rect) return;

		if (mq.mode === "create") {
			setTool("select");
			if (rect.width >= 40 && rect.height >= 40) {
				void session
					.createFrame(
						t("canvas.newFrame.defaultTitle"),
						Math.round(rect.width),
						Math.round(rect.height),
						Math.round(rect.x),
						Math.round(rect.y),
					)
					.then((id) => setSelection({ kind: "frames", ids: [id] }));
			}
			return;
		}

		if (rect.width < MARQUEE_MIN && rect.height < MARQUEE_MIN) return;
		const hits = manifest.frames.filter((frame) => intersects(rect, frame)).map((frame) => frame.id);
		if (hits.length === 0) return;
		setSelection((current) => {
			const base = event.shiftKey && current ? selectedFrameIds(current) : [];
			const ids = [...new Set([...base, ...hits])];
			return { kind: "frames", ids };
		});
	};

	const zoomBy = (direction: 1 | -1): void => {
		const container = containerRef.current;
		const bounds = container?.getBoundingClientRect();
		const centerX = (bounds?.width ?? 0) / 2;
		const centerY = (bounds?.height ?? 0) / 2;
		const current = viewportRef.current;
		const nextZoom = clampZoom(direction === 1 ? current.zoom * ZOOM_STEP : current.zoom / ZOOM_STEP);
		const scale = nextZoom / current.zoom;
		const next = {
			zoom: nextZoom,
			x: centerX - (centerX - current.x) * scale,
			y: centerY - (centerY - current.y) * scale,
		};
		setViewport(next);
		session.saveViewport(next);
	};

	/** Grab the placement of every frame that will travel with this drag. */
	const beginMove = (frameId: string, additive: boolean): void => {
		const already = selectedFrameIds(selectionRef.current);
		let ids: string[];
		if (additive) {
			selectFrame(frameId, true);
			ids = already.includes(frameId) ? already.filter((id) => id !== frameId) : [...already, frameId];
		} else if (already.includes(frameId)) {
			// Dragging a member of the current selection moves the whole group.
			ids = already;
		} else {
			setSelection({ kind: "frames", ids: [frameId] });
			ids = [frameId];
		}
		const origins = new Map<string, { x: number; y: number }>();
		for (const id of ids) {
			const frame = manifest.frames.find((entry) => entry.id === id);
			if (frame) origins.set(id, { x: frame.x, y: frame.y });
		}
		moveRef.current = { origins };
	};

	const commitMove = (): void => {
		const state = moveRef.current;
		const delta = moveDelta;
		moveRef.current = null;
		setMoveDelta(null);
		if (!state || !delta || (delta.dx === 0 && delta.dy === 0)) return;
		for (const [id, origin] of state.origins) {
			void session.updateFramePlacement(id, { x: origin.x + delta.dx, y: origin.y + delta.dy });
		}
	};

	/**
	 * 位图态的 frame 是 display:none，没有布局也就截不出东西，先经 runLive 拉回活体。
	 * 交付物保留 cacheBust：慢，但能兜住素材缓存缺 CORS 头的边角情况。
	 */
	const captureFaithfully = useCallback(
		(frameId: string, options?: { keepHighlight?: boolean; pixelRatio?: number }): Promise<string> =>
			runLive(frameId, () => bridge.capture(frameId, { ...options, cacheBust: true, timeoutMs: 30_000 })),
		[bridge, runLive],
	);

	// vetd_screenshot 走的是 CanvasTab 注册的 controller，够不到这里的 runLive，
	// 于是把入口挂出去。卸载时清空：画布不在了，工具应立刻报错而不是截空图。
	useEffect(() => {
		captureRef.current = (frameId) => captureFaithfully(frameId);
		return () => {
			captureRef.current = null;
		};
	}, [captureRef, captureFaithfully]);

	const selectedIds = selectedFrameIds(selection);
	/** Export / ask act on canvas order, not on click order. */
	const orderedSelection = manifest.frames.filter((frame) => selectedIds.includes(frame.id)).sort(byCanvasOrder);

	/** "让 Vetta 调整"：N 张截图（DOM 选中时保留高亮）+ 元信息 + 用户建议 → sendPrompt。 */
	const sendAskToVetta = (suggestion: string): void => {
		if (askBusy) return;
		// 关掉浮层是「已交出去」的反馈，不等截图落盘、更不等 Vetta 跑完：
		// sendPrompt 复用会话的完整发送链路，要整轮结束才 resolve。
		setAskOpen(false);
		setAskBusy(true);
		void (async () => {
			try {
				const ctx = getPluginCtx();
				const domFrameId = selection?.kind === "dom" ? selection.frameId : null;
				const shots: AskShot[] = [];
				for (const frame of orderedSelection) {
					const dataUrl = await captureFaithfully(frame.id, { keepHighlight: frame.id === domFrameId });
					const base64 = dataUrl.split(",")[1] ?? "";
					const screenshotPath = `${session.dirPath}/.snapshots/ask-${frame.id}-${Date.now()}.png`;
					await ctx.fs.writeFile(screenshotPath, base64, "base64");
					shots.push({ frameId: frame.id, screenshotPath });
				}
				const dom = selection?.kind === "dom" ? { frameId: selection.frameId, payload: selection.payload } : null;
				const prompt = buildAskPrompt(session, { shots, dom }, suggestion);
				void ctx.conversation.sendPrompt(prompt).catch((error: unknown) => {
					notify({ message: t("canvas.ask.failed"), error });
				});
				notify({ message: t("canvas.ask.sent"), variant: "success", durationMs: 3000 });
			} catch (error) {
				notify({ message: t("canvas.ask.failed"), error });
			} finally {
				setAskBusy(false);
			}
		})();
	};

	const openExport = (): void => {
		if (orderedSelection.length === 0) return;
		requestMockupExport({
			session,
			frameIds: orderedSelection.map((frame) => frame.id),
			capture: (frameId, pixelRatio) => captureFaithfully(frameId, { pixelRatio }),
		});
	};

	/** 菜单「复制为图片」：按 2 倍截一张，走宿主原生剪贴板。 */
	const copyFrameImage = (frameId: string): void => {
		setMenuAnchor(null);
		void (async () => {
			try {
				const dataUrl = await captureFaithfully(frameId, { pixelRatio: COPY_PIXEL_RATIO });
				await getPluginCtx().ui.copyImage(dataUrl);
				notify({ message: t("canvas.frame.copyImage.done"), variant: "success", durationMs: 3000 });
			} catch (error) {
				notify({ message: t("canvas.frame.copyImage.failed"), error });
			}
		})();
	};

	/** 提交重命名。空标题/没改动由 session 自行忽略，这里只管收编辑态。 */
	const commitRename = (frameId: string, title: string): void => {
		setRenamingId(null);
		void session.renameFrame(frameId, title).catch((error: unknown) => {
			notify({ message: t("canvas.frame.rename.failed"), error });
		});
	};

	const startRename = (frameId: string): void => {
		setMenuAnchor(null);
		if (enteredFrameId === frameId) exitInspect(frameId);
		setSelection({ kind: "frames", ids: [frameId] });
		setRenamingId(frameId);
	};

	const deleteFrame = (frameId: string): void => {
		setDeletingId(null);
		if (renamingId === frameId) setRenamingId(null);
		if (enteredFrameId === frameId) exitInspect(frameId);
		setSelection((current) => {
			const ids = selectedFrameIds(current).filter((id) => id !== frameId);
			return ids.length > 0 ? { kind: "frames", ids } : null;
		});
		void session.deleteFrame(frameId).catch((error: unknown) => {
			notify({ message: t("canvas.frame.delete.failed"), error });
		});
	};

	const deletingFrame = deletingId ? manifest.frames.find((frame) => frame.id === deletingId) : undefined;

	const cursor = panActive ? "grab" : tool === "frame" ? "crosshair" : "default";

	return (
		<div
			ref={containerRef}
			// select-none：画布外壳（frame 标题、尺寸标注等）不参与文本选择，
			// 否则拖动平移会把它们刷成蓝色高亮，看着像选中了 frame。
			className="relative h-full w-full select-none overflow-hidden outline-none vetd-canvas-bg"
			style={{ cursor }}
			tabIndex={-1}
			role="application"
			// 画布是自己的操作面，任何位置都不弹浏览器原生菜单；frame 上的右键由
			// FrameView 拦截并上报（它会 stopPropagation，到不了这里）。
			onContextMenu={(event) => {
				event.preventDefault();
				setMenuAnchor(null);
			}}
			onPointerDown={onBackgroundPointerDown}
			onPointerMove={onBackgroundPointerMove}
			onPointerUp={onBackgroundPointerUp}
		>
			<div
				ref={worldRef}
				className="absolute left-0 top-0"
				style={{
					transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
					transformOrigin: "0 0",
					// 刻意不加 will-change / translateZ：这一层的包围盒覆盖所有 frame，
					// 动辄上万像素，强行提升成合成层会超出 GPU 纹理上限，合成器降级后
					// 整窗口撕裂闪烁。让浏览器自己决定要不要提升。
				}}
			>
				{manifest.frames.map((frame) => (
					<FrameView
						key={frame.id}
						frame={frame}
						port={port}
						zoom={viewport.zoom}
						bridge={bridge}
						selected={selectedIds.includes(frame.id)}
						entered={enteredFrameId === frame.id}
						interactive={tool === "select" && !panActive}
						resizable={selectedIds.length === 1}
						mounted={isMounted(frame.id)}
						live={isLive(frame.id)}
						raster={rasterOf(frame.id)}
						moveDelta={moveRef.current?.origins.has(frame.id) ? moveDelta : null}
						activity={activity.get(frame.id)}
						renaming={renamingId === frame.id}
						onRenameStart={() => startRename(frame.id)}
						onRenameCommit={(title) => commitRename(frame.id, title)}
						onRenameCancel={() => setRenamingId(null)}
						onSelect={(additive) => {
							if (enteredFrameId && enteredFrameId !== frame.id) exitInspect(enteredFrameId);
							selectFrame(frame.id, additive);
						}}
						onEnter={() => {
							if (enteredFrameId && enteredFrameId !== frame.id) exitInspect(enteredFrameId);
							setSelection({ kind: "frames", ids: [frame.id] });
							setEnteredFrameId(frame.id);
							bridge.setMode(frame.id, "inspect");
						}}
						onContextMenu={(clientX, clientY) => openFrameMenu(frame.id, clientX, clientY)}
						onMoveStart={(additive) => {
							if (enteredFrameId && enteredFrameId !== frame.id) exitInspect(enteredFrameId);
							beginMove(frame.id, additive);
						}}
						onMoveDelta={(dx, dy) => setMoveDelta({ dx, dy })}
						onMoveEnd={commitMove}
						onResizeCommit={(patch) => session.updateFramePlacement(frame.id, patch)}
					/>
				))}
				{marquee ? (
					<div
						className="absolute border border-[var(--vetd-selected)] vetd-marquee-fill"
						style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
					/>
				) : null}
			</div>

			{/* Pan shield: 托手工具或按住空格时，盖住所有 frame 接管拖动（Figma 行为），
			    frame 内起手也只平移、不选中。 */}
			{panActive ? <div className="absolute inset-0 z-10" style={{ cursor: "grab" }} /> : null}

			{menuAnchor ? (
				<FrameContextMenu
					anchor={menuAnchor}
					onAsk={() => {
						setMenuAnchor(null);
						setAskOpen(true);
					}}
					onRename={() => startRename(menuAnchor.frameId)}
					onCopyImage={() => copyFrameImage(menuAnchor.frameId)}
					onExportMockup={() => {
						setMenuAnchor(null);
						openExport();
					}}
					onDelete={() => {
						setDeletingId(menuAnchor.frameId);
						setMenuAnchor(null);
					}}
					onClose={() => setMenuAnchor(null)}
				/>
			) : null}

			{deletingFrame ? (
				<ConfirmDialog
					title={t("canvas.frame.delete.title")}
					description={t("canvas.frame.delete.desc", {
						name: deletingFrame.title || deletingFrame.id,
						file: deletingFrame.file,
					})}
					confirmLabel={t("canvas.frame.delete.confirm")}
					cancelLabel={t("canvas.frame.delete.cancel")}
					danger
					onConfirm={() => deleteFrame(deletingFrame.id)}
					onCancel={() => setDeletingId(null)}
				/>
			) : null}

			{askOpen ? (
				<AskVettaPopover
					busy={askBusy}
					onSend={sendAskToVetta}
					onClose={() => setAskOpen(false)}
				/>
			) : null}

			{!panActive ? (
				<AskVettaButton
					selectedCount={orderedSelection.length}
					elementMode={selection?.kind === "dom"}
					active={askOpen}
					onClick={() => setAskOpen((open) => !open)}
				/>
			) : null}

			<ControlBar
				tool={tool}
				zoom={viewport.zoom}
				exportableCount={orderedSelection.length}
				onToolChange={setTool}
				onZoomDelta={zoomBy}
				onZoomReset={() => {
					const next = { ...viewportRef.current, zoom: 1 };
					setViewport(next);
					session.saveViewport(next);
				}}
				onExport={openExport}
			/>
		</div>
	);
}
