import { useTranslation } from "@vetta-org/plugin-sdk";
import {
	type CSSProperties,
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
import {
	type ArrangeItem,
	type GapBand,
	gapBands,
	type GridSpec,
	inferGrid,
	layoutGrid,
	type Placement,
} from "./arrange";
import { ArrangeToolbar } from "./ArrangeToolbar";
import { type AskShot, buildAskPrompt } from "./ask-vetta";
import { AskVettaButton } from "./AskVettaButton";
import { AskVettaPopover } from "./AskVettaPopover";
import { BridgeHub, type SelectedElementPayload } from "./bridge-client";
import { ConfirmDialog } from "./ConfirmDialog";
import { ControlBar, type CanvasTool } from "./ControlBar";
import {
	clearFrameErrors,
	type FrameActivity,
	getFrameError,
	notifyFrameSettled,
	onFrameActivity,
	onFrameErrors,
	requestMockupExport,
	setFrameError,
} from "./design-runtime";
import { DesignSystemDrawer } from "./DesignSystemDrawer";
import { type FrameMenuAnchor, FrameContextMenu } from "./FrameContextMenu";
import { useFrameRasters } from "./frame-raster";
import { type FrameDragEdge, FrameView } from "./FrameView";
import { GapHandles } from "./GapHandles";
import {
	boundsOf,
	describeSnap,
	NO_SNAP,
	type SnapDecoration,
	type SnapEdge,
	type SnapRect,
	type SnapSolution,
	solveSnap,
} from "./snap";
import { SnapGuides } from "./SnapGuides";

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
/**
 * 视口裁剪的预留量，单位是「屏」：可见区域外这么多才停止渲染 frame。
 *
 * 留一整屏是为了平移能先滑一段再需要重算列表；SLACK 是重算的触发线——可见区域
 * 逼近已裁剪范围边缘、余量不足半屏时才重新算一次，平移途中不必每帧都过一遍。
 */
const CULL_MARGIN_SCREENS = 1;
const CULL_SLACK_SCREENS = 0.5;
/** frame 的最小尺寸（世界单位），改尺寸拖过头时钳在这儿。 */
const MIN_WIDTH = 100;
const MIN_HEIGHT = 80;
/**
 * 吸附容差，单位是**屏幕**像素：换算成世界单位要除以 zoom，这样缩到 10% 还是放到
 * 400%，手感都是「鼠标移到差不多这么近就吸上」。
 */
const SNAP_THRESHOLD_PX = 8;

function clampZoom(zoom: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** 四周同时外扩（负值即内缩）。 */
function inflate(rect: Rect, dx: number, dy: number): Rect {
	return { x: rect.x - dx, y: rect.y - dy, width: rect.width + dx * 2, height: rect.height + dy * 2 };
}

function contains(outer: Rect, inner: Rect): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
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

/**
 * 把手柄的指针位移作用到原始矩形上（含最小尺寸钳制），结果取整。
 *
 * 注意 `edge.includes("e")`：`"ne"` 也含 "e"，右上角本来就要同时动右边和上边，
 * 靠的正是这个；南北向则由下面两个显式判断分管。
 */
function applyResize(origin: SnapRect, edge: Exclude<FrameDragEdge, "move">, dx: number, dy: number): SnapRect {
	let { x, y, width, height } = origin;
	if (edge.includes("e")) width = origin.width + dx;
	if (edge.includes("s")) height = origin.height + dy;
	if (edge.includes("w")) {
		width = origin.width - dx;
		x = origin.x + dx;
	}
	if (edge === "nw" || edge === "ne") {
		height = origin.height - dy;
		y = origin.y + dy;
	}
	if (width < MIN_WIDTH) {
		if (edge.includes("w")) x -= MIN_WIDTH - width;
		width = MIN_WIDTH;
	}
	if (height < MIN_HEIGHT) {
		if (edge === "nw" || edge === "ne") y -= MIN_HEIGHT - height;
		height = MIN_HEIGHT;
	}
	return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** 改尺寸时哪几条线参与吸附：只有被拖的那条边，对侧固定不动。 */
function resizeSnapEdges(edge: Exclude<FrameDragEdge, "move">): { x: readonly SnapEdge[]; y: readonly SnapEdge[] } {
	const x: SnapEdge[] = edge.includes("w") ? ["start"] : edge.includes("e") ? ["end"] : [];
	const y: SnapEdge[] = edge === "nw" || edge === "ne" ? ["start"] : edge.includes("s") ? ["end"] : [];
	return { x, y };
}

/**
 * 把吸附修正量落到改尺寸的结果上：动的是被拖的那条边，所以西/北向要同时改起点和
 * 尺寸。修正后跌破最小尺寸的轴整条放弃（连同它的引导线），宁可不吸也不缩过头。
 */
function applyResizeSnap(
	rect: SnapRect,
	edge: Exclude<FrameDragEdge, "move">,
	snap: SnapSolution,
): { rect: SnapRect; snap: SnapSolution } {
	const next = { ...rect };
	const applied: SnapSolution = { ...snap };
	if (snap.x) {
		if (edge.includes("w")) {
			next.x += snap.x.offset;
			next.width -= snap.x.offset;
		} else {
			next.width += snap.x.offset;
		}
		if (next.width < MIN_WIDTH) {
			next.x = rect.x;
			next.width = rect.width;
			applied.x = null;
		}
	}
	if (snap.y) {
		if (edge === "nw" || edge === "ne") {
			next.y += snap.y.offset;
			next.height -= snap.y.offset;
		} else {
			next.height += snap.y.offset;
		}
		if (next.height < MIN_HEIGHT) {
			next.y = rect.y;
			next.height = rect.height;
			applied.y = null;
		}
	}
	return { rect: next, snap: applied };
}

export function DesignCanvas({ session, port, bridge, captureRef, refreshRef }: DesignCanvasProps) {
	const { t } = useTranslation();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [manifest, setManifest] = useState<VetdManifest>(session.manifest);
	// 下面那些交给 FrameView 的回调必须引用稳定（memo 的前提），所以它们读 ref 而不是
	// 闭包捕获随渲染变化的 state。
	const manifestRef = useRef(manifest);
	manifestRef.current = manifest;
	const [viewport, setViewport] = useState<Viewport>(() => ({ ...session.manifest.canvas }));
	const viewportRef = useRef(viewport);
	viewportRef.current = viewport;
	const [tool, setTool] = useState<CanvasTool>("select");
	const [spaceHeld, setSpaceHeld] = useState(false);
	const [selection, setSelection] = useState<CanvasSelection>(null);
	const selectionRef = useRef(selection);
	selectionRef.current = selection;
	const [activity, setActivity] = useState<ReadonlyMap<string, FrameActivity>>(new Map());
	/** 错误态存在 design-runtime（agent 工具也要读），这里只订阅它来渲染。 */
	const [frameErrors, setFrameErrors] = useState<ReadonlyMap<string, string>>(new Map());
	const [marquee, setMarquee] = useState<Rect | null>(null);
	const [askOpen, setAskOpen] = useState(false);
	const [askBusy, setAskBusy] = useState(false);
	/** 底部设计体系抽屉。升起时 ControlBar 与「让 Vetta 调整」淡出让位。 */
	const [designDrawerOpen, setDesignDrawerOpen] = useState(false);
	const [menuAnchor, setMenuAnchor] = useState<FrameMenuAnchor | null>(null);
	/** 正在就地重命名的 frame id（标题栏变输入框）。 */
	const [renamingId, setRenamingId] = useState<string | null>(null);
	/** 待确认删除的 frame id，非 null 时显示二次确认。 */
	const [deletingId, setDeletingId] = useState<string | null>(null);
	const [moveDelta, setMoveDelta] = useState<{ dx: number; dy: number } | null>(null);
	const moveDeltaRef = useRef(moveDelta);
	moveDeltaRef.current = moveDelta;
	/** 改尺寸拖拽期间的实时矩形。提交前不落 manifest，只下发给那一个 FrameView。 */
	const [resizeRect, setResizeRect] = useState<{ frameId: string; rect: SnapRect } | null>(null);
	const resizeRectRef = useRef(resizeRect);
	resizeRectRef.current = resizeRect;
	/** 当前要画的吸附引导线与缝隙标注，只在拖拽/拉框期间非 null。 */
	const [snapView, setSnapView] = useState<SnapDecoration | null>(null);
	/**
	 * 用户在宫格里选定的列数。null 表示跟着当前摆放推断——只有明确选过才固定下来，
	 * 否则「自动排列」会把用户上一秒亲手摆出的行列关系抹掉。
	 */
	const [columnsOverride, setColumnsOverride] = useState<number | null>(null);
	/** 拖 gap 期间的实时位置预览（frameId → 新位置），松手才落盘。 */
	const [layoutOverride, setLayoutOverride] = useState<ReadonlyMap<string, Placement> | null>(null);
	/** 正在拖的那条缝，用来把手柄高亮钉住（指针早跑出命中区了）。 */
	const [activeGap, setActiveGap] = useState<{ axis: "x" | "y"; index: number } | null>(null);
	const gapDragRef = useRef<{
		band: GapBand;
		startClient: number;
		startGap: number;
		spec: GridSpec;
		items: ArrangeItem[];
		origin: Placement;
	} | null>(null);
	/** 拖 gap 松手时要落盘的位置，与 layoutOverride 同源（state 读不到最新值）。 */
	const layoutOverrideRef = useRef(layoutOverride);
	layoutOverrideRef.current = layoutOverride;
	const panRef = useRef<{ pointerId: number; startX: number; startY: number; origin: Viewport } | null>(null);
	const marqueeRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		mode: "create" | "select";
		/** 新建拉框时的吸附候选，起手时快照一次。 */
		targets: SnapRect[];
	} | null>(null);
	/**
	 * 进行中的 frame 拖拽（移动或改尺寸）。几何全在这儿：origins 是起手时的原始矩形，
	 * targets 是同一时刻快照下来的吸附候选（可见视口内、不在拖动集合里的 frame）。
	 */
	const dragRef = useRef<{
		edge: FrameDragEdge;
		origins: Map<string, SnapRect>;
		/** 移动时是整组包围盒，改尺寸时就是被拖那个 frame 的原始矩形。 */
		originBounds: SnapRect;
		primaryId: string;
		targets: SnapRect[];
	} | null>(null);
	/** 平移进行中的实时视口。非 null 时 DOM 上的 transform 由它驱动，state 落后一步。 */
	const panLiveRef = useRef<Viewport | null>(null);
	const rafRef = useRef<number | null>(null);
	const wheelSettleRef = useRef<number | null>(null);
	const worldRef = useRef<HTMLDivElement | null>(null);

	/** 容器像素尺寸，视口裁剪要用。 */
	const sizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
	/**
	 * 当前允许渲染的世界矩形（可见区域 + CULL_MARGIN_SCREENS 屏预留）。null 表示还
	 * 没量到容器尺寸，那时不裁剪。
	 */
	const [cullRect, setCullRect] = useState<Rect | null>(null);
	const cullRectRef = useRef<Rect | null>(null);
	cullRectRef.current = cullRect;

	const paintViewport = useCallback((next: Viewport): void => {
		const world = worldRef.current;
		if (world) world.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.zoom})`;
	}, []);

	/**
	 * 按当前视口更新裁剪矩形。够用就原地不动——这个函数在平移的每一帧、缩放的每个
	 * wheel tick 都会被调用，每次都 setState 等于把「绕开 React」的努力还回去。
	 *
	 * 两种情况才重算：
	 * - 余量不足半屏：接着平移/缩小就要露出没渲染的区域了。
	 * - 范围比需要的大一倍以上：放大之后旧矩形还按老比例留着，会一直多渲染一堆 frame。
	 */
	const syncCullRect = useCallback((vp: Viewport): void => {
		const { width, height } = sizeRef.current;
		if (width === 0 || height === 0) return;
		const worldWidth = width / vp.zoom;
		const worldHeight = height / vp.zoom;
		const visible: Rect = { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, width: worldWidth, height: worldHeight };
		const next = inflate(visible, worldWidth * CULL_MARGIN_SCREENS, worldHeight * CULL_MARGIN_SCREENS);
		const current = cullRectRef.current;
		if (current) {
			const slack = inflate(current, -worldWidth * CULL_SLACK_SCREENS, -worldHeight * CULL_SLACK_SCREENS);
			const oversized = current.width > next.width * 2 || current.height > next.height * 2;
			if (contains(slack, visible) && !oversized) return;
		}
		cullRectRef.current = next;
		setCullRect(next);
	}, []);

	/** 把高频 pointermove 折叠到每帧一次实际绘制。 */
	const schedulePaint = useCallback((): void => {
		if (rafRef.current !== null) return;
		rafRef.current = window.requestAnimationFrame(() => {
			rafRef.current = null;
			if (!panLiveRef.current) return;
			paintViewport(panLiveRef.current);
			syncCullRect(panLiveRef.current);
		});
	}, [paintViewport, syncCullRect]);

	// 缩放、平移落定、容器尺寸变化：都要按新的可见范围核对一次裁剪范围。
	useEffect(() => {
		syncCullRect(viewport);
	}, [viewport, syncCullRect]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const observer = new ResizeObserver(() => {
			sizeRef.current = { width: container.clientWidth, height: container.clientHeight };
			syncCullRect(panLiveRef.current ?? viewportRef.current);
		});
		observer.observe(container);
		return () => observer.disconnect();
	}, [syncCullRect]);

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

	// 错误态属于「当前打开的这份设计」，换设计/关画布时清掉，免得留给下一份。
	useEffect(() => {
		clearFrameErrors();
		return clearFrameErrors;
	}, [session]);

	useEffect(() => onFrameErrors((next) => setFrameErrors(new Map(next))), []);

	/** frameId → 该 frame 上报「已经画到屏幕上」的次数，见 FrameView 的 paintTick。 */
	const [paintTicks, setPaintTicks] = useState<ReadonlyMap<string, number>>(new Map());

	const panActive = tool === "hand" || spaceHeld;


	/**
	 * 「在操作」的那个 frame 保持活体：单独选中一个就够。多选不算，那是在排版，
	 * 全转活体会把合成压力又拉回来。
	 */
	const activeFrameId = useMemo(() => {
		const ids = selectedFrameIds(selection);
		return ids.length === 1 ? ids[0] : null;
	}, [selection]);

	/**
	 * 元素选择开在哪个 frame 上。
	 *
	 * 曾经要双击才「进入」frame 才能点元素，多一步且没人猜得到。现在单独选中一个
	 * frame 就直接开——选中它本来就是为了看/改它的内容。代价是画面区的指针事件全
	 * 归 iframe，frame 自身的移动改走标题栏、缩放改走四角手柄（手柄因此不再随
	 * 「进入」隐藏，见 FrameView）。
	 *
	 * 托手工具/按住空格时不开：那时整块画布都在平移，指针不该被 iframe 吃掉。
	 */
	const inspectFrameId = tool === "select" && !panActive ? activeFrameId : null;

	/**
	 * 空闲 frame 用位图代替活体 iframe，画布上就不再有 N 套渲染树同时合成。
	 *
	 * 这个顺序就是挂载与截图的排队顺序（先挂 iframe 的先渲染、先进截图队列），所以
	 * 可见的必须排在前面：二十帧的设计稿冷启动时用户只看得见三五帧，按画布顺序排队
	 * 的话，屏幕外那些得先一个个截完才轮到眼前这几帧——期间它们一直转圈。
	 *
	 * 用 cullRect 而不是精确视口：它本来就带一屏预留，且只在余量不足半屏时才重算，
	 * 平移途中不会把队列反复打乱。
	 */
	const orderedFrameIds = useMemo(() => {
		const sorted = [...manifest.frames].sort(byCanvasOrder);
		if (!cullRect) return sorted.map((frame) => frame.id);
		const visible: string[] = [];
		const rest: string[] = [];
		for (const frame of sorted) (intersects(cullRect, frame) ? visible : rest).push(frame.id);
		return [...visible, ...rest];
	}, [manifest.frames, cullRect]);
	const {
		rasterOf,
		isMounted,
		isLive,
		invalidate: invalidateRaster,
		runLive,
		refreshAll,
		reloadAll,
		reloadNonce,
	} = useFrameRasters({ bridge, cacheKey: session.vetdPath, frameIds: orderedFrameIds, activeFrameId });

	refreshRef.current = reloadAll;

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

	/**
	 * 元素选择跟着 inspectFrameId 走：开在新的那个上，同时关掉上一个。
	 *
	 * 以前每个会改变选中的地方都得手动记着调 exitInspect（选别的 frame、右键菜单、
	 * 框选、删除、切工具…），漏一处就会出现两个 frame 同时高亮。收敛成一条派生
	 * 关系之后，选中变了模式自然跟着变，调用点一个都不用管。
	 */
	useEffect(() => {
		if (!inspectFrameId) return;
		bridge.setMode(inspectFrameId, "inspect");
		return () => bridge.setMode(inspectFrameId, "off");
	}, [bridge, inspectFrameId]);

	// 切到托手工具：清空选中（含 DOM 选中态），托手期间不产生任何选中。
	useEffect(() => {
		if (tool !== "hand") return;
		setSelection(null);
	}, [tool]);

	/**
	 * 右击 frame 弹菜单。菜单里的动作（让 Vetta 调整 / 导出渲染图）按当前选中执行，
	 * 所以右击一个没选中的 frame 要先把它选上——否则动作会落在别处，或者无从执行。
	 * 已在选中集合里的则保持原选中（含 DOM 选中态），多选右击不打散分组。
	 *
	 * 两个来源：画布层的 contextmenu（frame 没开元素选择时），以及元素选择期间由
	 * 引擎从 iframe 里转发出来的（那时右键落在跨源文档上，画布层根本收不到）。
	 */
	const openFrameMenu = useCallback((frameId: string, clientX: number, clientY: number): void => {
		containerRef.current?.focus();
		setSelection((current) =>
			selectedFrameIds(current).includes(frameId) ? current : { kind: "frames", ids: [frameId] },
		);
		setAskOpen(false);
		const bounds = containerRef.current?.getBoundingClientRect();
		setMenuAnchor({ frameId, x: clientX - (bounds?.left ?? 0), y: clientY - (bounds?.top ?? 0) });
	}, []);

	useEffect(() => {
		bridge.start({
			onSelected: (frameId, payload) => {
				setSelection(payload ? { kind: "dom", frameId, payload } : { kind: "frames", ids: [frameId] });
			},
			// 引擎侧 Esc 走到顶：还选着元素就只清元素（frame 仍选中，可以接着点下一个），
			// 已经什么都没选了才真的退出这个 frame。焦点在 iframe 里时画布层收不到
			// keydown，这两级都只能从引擎过来。
			onExitInspect: (frameId, hadSelection) => {
				setSelection(hadSelection ? { kind: "frames", ids: [frameId] } : null);
			},
			onHmrUpdated: (frameId) => {
				notifyFrameSettled(frameId);
				if (frameId) invalidateRaster(frameId);
			},
			onRendered: (frameId) => {
				invalidateRaster(frameId);
				// 同一条信号还负责位图→活体的交接：计数自增，FrameView 拿它判断
				// 「这一次挂载之后画面已经出来了」。
				setPaintTicks((current) => new Map(current).set(frameId, (current.get(frameId) ?? 0) + 1));
			},
			onFrameError: setFrameError,
			onFrameContextMenu: openFrameMenu,
		});
		return () => bridge.stop();
	}, [bridge, invalidateRaster, openFrameMenu]);

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
				// 焦点在画布上时的 Esc（元素选中期间焦点在 iframe 里，那时 Esc 由引擎侧
				// 处理：逐级选父元素，到顶再发 exit-inspect 把元素选中清掉）。
				// 到这里就是最后一级：取消 frame 选中。
				setSelection(null);
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
	}, []);

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

	/**
	 * 吸附候选：当前可见视口内、且不在 exclude 里的 frame。
	 *
	 * 只取看得见的（不是 cullRect 那一圈预留）——被屏幕外的东西隔空拽走，用户既看不到
	 * 引导线的另一端，也不知道为什么位置跳了。拖拽期间视口不动，起手快照一次即可。
	 */
	const snapTargetsOf = useCallback((exclude: ReadonlySet<string>): SnapRect[] => {
		const vp = viewportRef.current;
		const { width, height } = sizeRef.current;
		const visible: Rect = {
			x: -vp.x / vp.zoom,
			y: -vp.y / vp.zoom,
			width: width / vp.zoom,
			height: height / vp.zoom,
		};
		return manifestRef.current.frames
			.filter((frame) => !exclude.has(frame.id) && intersects(visible, frame))
			.map((frame) => ({ x: frame.x, y: frame.y, width: frame.width, height: frame.height }));
	}, []);

	/** 世界单位的吸附容差（屏幕像素 ÷ 当前缩放）。 */
	const snapThreshold = useCallback((): number => SNAP_THRESHOLD_PX / viewportRef.current.zoom, []);

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
		const mode = tool === "frame" ? "create" : "select";
		marqueeRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			mode,
			// 框选不吸附（它不产生几何，只是选东西），只有新建才需要候选。
			targets: mode === "create" ? snapTargetsOf(new Set()) : [],
		};
		const world = toWorld(event.clientX, event.clientY);
		setMarquee({ x: world.x, y: world.y, width: 0, height: 0 });
		// Select tool on empty canvas: drop the current selection unless extending it.
		if (tool !== "frame" && !event.shiftKey) {
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
			// 新建时吸的是跟着指针跑的那个角：把它当成 0×0 的矩形去求解，起手那个角不动。
			const bypassSnap = event.metaKey || event.ctrlKey;
			const snap =
				mq.mode === "create" && !bypassSnap
					? solveSnap({
							moving: { x: now.x, y: now.y, width: 0, height: 0 },
							targets: mq.targets,
							threshold: snapThreshold(),
							edges: { x: ["start"], y: ["start"] },
						})
					: NO_SNAP;
			const cornerX = now.x + (snap.x?.offset ?? 0);
			const cornerY = now.y + (snap.y?.offset ?? 0);
			const rect = {
				x: Math.min(start.x, cornerX),
				y: Math.min(start.y, cornerY),
				width: Math.abs(cornerX - start.x),
				height: Math.abs(cornerY - start.y),
			};
			setMarquee(rect);
			setSnapView(snap.x || snap.y ? describeSnap(rect, mq.targets, snap) : null);
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
		setSnapView(null);
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
	const beginDrag = useCallback(
		(frameId: string, edge: FrameDragEdge, additive: boolean): void => {
			const already = selectedFrameIds(selectionRef.current);
			let ids: string[];
			if (edge !== "move") {
				// 手柄只对单选出现，起手先把选中收敛到它，后续的提交/引导线才有唯一主体。
				setSelection({ kind: "frames", ids: [frameId] });
				ids = [frameId];
			} else if (additive) {
				selectFrame(frameId, true);
				ids = already.includes(frameId) ? already.filter((id) => id !== frameId) : [...already, frameId];
			} else if (already.includes(frameId)) {
				// Dragging a member of the current selection moves the whole group.
				ids = already;
			} else {
				setSelection({ kind: "frames", ids: [frameId] });
				ids = [frameId];
			}
			const origins = new Map<string, SnapRect>();
			for (const id of ids) {
				const frame = manifestRef.current.frames.find((entry) => entry.id === id);
				if (frame) origins.set(id, { x: frame.x, y: frame.y, width: frame.width, height: frame.height });
			}
			const originBounds = boundsOf([...origins.values()]);
			if (!originBounds) return;
			dragRef.current = {
				edge,
				origins,
				originBounds,
				primaryId: frameId,
				targets: snapTargetsOf(new Set(origins.keys())),
			};
		},
		[selectFrame, snapTargetsOf],
	);

	/**
	 * 拖拽进行中：把原始指针位移换算成实时几何，顺带求吸附。
	 *
	 * 没吸上的轴照旧取整（frame 坐标一向是整数），吸上的轴用精确值——中线对齐在宽度
	 * 奇偶不同时就是 .5，取整回去等于差 1px 没对上，引导线会显得在撒谎。
	 */
	const handleDragDelta = useCallback((dx: number, dy: number, bypassSnap: boolean): void => {
		const drag = dragRef.current;
		if (!drag) return;
		const threshold = snapThreshold();
		if (drag.edge === "move") {
			const moved = { ...drag.originBounds, x: drag.originBounds.x + dx, y: drag.originBounds.y + dy };
			const snap = bypassSnap ? NO_SNAP : solveSnap({ moving: moved, targets: drag.targets, threshold });
			const finalDx = snap.x ? dx + snap.x.offset : Math.round(dx);
			const finalDy = snap.y ? dy + snap.y.offset : Math.round(dy);
			setMoveDelta({ dx: finalDx, dy: finalDy });
			const snapped = { ...drag.originBounds, x: drag.originBounds.x + finalDx, y: drag.originBounds.y + finalDy };
			setSnapView(snap.x || snap.y ? describeSnap(snapped, drag.targets, snap) : null);
			return;
		}
		const edge = drag.edge;
		const raw = applyResize(drag.originBounds, edge, dx, dy);
		const solution = bypassSnap
			? NO_SNAP
			: solveSnap({ moving: raw, targets: drag.targets, threshold, edges: resizeSnapEdges(edge) });
		const { rect, snap } = applyResizeSnap(raw, edge, solution);
		setResizeRect({ frameId: drag.primaryId, rect });
		setSnapView(snap.x || snap.y ? describeSnap(rect, drag.targets, snap) : null);
	}, [snapThreshold]);

	const commitDrag = useCallback((): void => {
		const drag = dragRef.current;
		dragRef.current = null;
		const delta = moveDeltaRef.current;
		const resize = resizeRectRef.current;
		setMoveDelta(null);
		setResizeRect(null);
		setSnapView(null);
		if (!drag) return;
		if (drag.edge === "move") {
			if (!delta || (delta.dx === 0 && delta.dy === 0)) return;
			const patches = new Map<string, Placement>();
			for (const [id, origin] of drag.origins) patches.set(id, { x: origin.x + delta.dx, y: origin.y + delta.dy });
			session.updateFramePlacements(patches);
			return;
		}
		if (!resize) return;
		void session.updateFramePlacement(resize.frameId, resize.rect);
		// 位图是按旧尺寸截的，改完尺寸再显示就是被 object-cover 拉伸裁剪
		// 的糊图——重新排队截一张。
		invalidateRaster(resize.frameId);
	}, [session, invalidateRaster]);

	/** FrameView 拖动/缩放要把指针位移换算成世界位移，但 zoom 不作为 prop 下发。 */
	const getZoom = useCallback((): number => viewportRef.current.zoom, []);

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

	const selectedIds = useMemo(() => selectedFrameIds(selection), [selection]);
	/** Export / ask act on canvas order, not on click order. */
	const orderedSelection = manifest.frames.filter((frame) => selectedIds.includes(frame.id)).sort(byCanvasOrder);

	/**
	 * 选中集的矩形，拖 gap 期间取预览位置——工具条与手柄都靠它定位，用 manifest 里
	 * 的旧位置会让它们在拖动中原地不动。
	 */
	const arrangeItems = useMemo<ArrangeItem[]>(
		() =>
			orderedSelection.map((frame) => {
				const placement = layoutOverride?.get(frame.id);
				return {
					id: frame.id,
					x: placement?.x ?? frame.x,
					y: placement?.y ?? frame.y,
					width: frame.width,
					height: frame.height,
				};
			}),
		// biome-ignore lint/correctness/useExhaustiveDependencies: orderedSelection 每次渲染都是新数组，用它的 id 序列做依赖
		[selectedIds, manifest.frames, layoutOverride],
	);
	const grid = useMemo(() => inferGrid(arrangeItems), [arrangeItems]);
	const arrangeColumns = columnsOverride ?? grid.columns;
	const arrangeBounds = useMemo(() => boundsOf(arrangeItems), [arrangeItems]);
	const gapHandles = useMemo(() => gapBands(arrangeItems), [arrangeItems]);

	// 选中集变了，上一次选的列数就不再适用（frame 数量都不一样了）。
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只按选中集变化重置
	useEffect(() => setColumnsOverride(null), [selectedIds]);

	/** 按给定列数重排选中集：顺序与间距沿用当前推断，起点钉在原包围盒左上角。 */
	const applyArrange = useCallback(
		(columns: number): void => {
			if (!arrangeBounds || arrangeItems.length < 2) return;
			const spec: GridSpec = { ...grid, columns: Math.max(1, columns) };
			const placements = layoutGrid(arrangeItems, spec, arrangeBounds);
			session.updateFramePlacements(placements);
		},
		[arrangeBounds, arrangeItems, grid, session],
	);

	const handlePickColumns = useCallback(
		(columns: number): void => {
			setColumnsOverride(columns);
			applyArrange(columns);
		},
		[applyArrange],
	);

	/**
	 * 拖某条缝改间距：横向的统一改所有列间距，纵向的改所有行间距，然后整块按网格重排。
	 *
	 * 只改被拖的那一条缝是做不到的——画布没有布局容器，后面的 frame 不会自己跟着让位，
	 * 拉宽一条缝只会让它压到下一列身上。统一间距同时也是 Figma 里拖 gap 的语义。
	 */
	const startGapDrag = useCallback(
		(band: GapBand, event: ReactPointerEvent): void => {
			if (!arrangeBounds || arrangeItems.length < 2) return;
			const spec: GridSpec = { ...grid, columns: arrangeColumns };
			gapDragRef.current = {
				band,
				startClient: band.axis === "x" ? event.clientX : event.clientY,
				startGap: band.axis === "x" ? spec.gapX : spec.gapY,
				spec,
				items: arrangeItems,
				origin: { x: arrangeBounds.x, y: arrangeBounds.y },
			};
			setActiveGap({ axis: band.axis, index: band.index });
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		},
		[arrangeBounds, arrangeItems, arrangeColumns, grid],
	);

	// 拖 gap 的移动与收尾挂在 window 上：手柄本身会随着重排跑掉，指针很容易脱离它。
	useEffect(() => {
		const onMove = (event: PointerEvent): void => {
			const drag = gapDragRef.current;
			if (!drag) return;
			const client = drag.band.axis === "x" ? event.clientX : event.clientY;
			const next = Math.max(0, Math.round(drag.startGap + (client - drag.startClient) / viewportRef.current.zoom));
			const spec: GridSpec =
				drag.band.axis === "x" ? { ...drag.spec, gapX: next } : { ...drag.spec, gapY: next };
			setLayoutOverride(layoutGrid(drag.items, spec, drag.origin));
		};
		const onUp = (): void => {
			if (!gapDragRef.current) return;
			gapDragRef.current = null;
			setActiveGap(null);
			const placements = layoutOverrideRef.current;
			setLayoutOverride(null);
			if (placements) session.updateFramePlacements(placements);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
		};
	}, [session]);

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
				const prompt = buildAskPrompt(session, { shots, dom }, suggestion, ctx.i18n.locale);
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
	const commitRename = useCallback(
		(frameId: string, title: string): void => {
			setRenamingId(null);
			void session.renameFrame(frameId, title).catch((error: unknown) => {
				notify({ message: t("canvas.frame.rename.failed"), error });
			});
		},
		[session, t],
	);

	const startRename = useCallback((frameId: string): void => {
		setMenuAnchor(null);
		setSelection({ kind: "frames", ids: [frameId] });
		setRenamingId(frameId);
	}, []);

	const cancelRename = useCallback((): void => setRenamingId(null), []);

	const deleteFrame = (frameId: string): void => {
		setDeletingId(null);
		if (renamingId === frameId) setRenamingId(null);
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

	/**
	 * 整理相关的浮层出不出。拖动/改尺寸期间收起来：那时选区每帧都在动，工具条跟着
	 * 抖不说，gap 手柄还会去抢正在拖拽的指针。
	 */
	const arrangeActive =
		selectedIds.length >= 2 && tool === "select" && !panActive && moveDelta === null && resizeRect === null;

	/**
	 * 视口裁剪：看不见的 frame 连 DOM 都不建。
	 *
	 * 位图化已经把「N 个活体 iframe」降成了「N 张 img」，但 img 一样有代价：每张
	 * 2x jpeg 解码后是 width*height*4 字节的位图，几十帧就是几百 MB，低配机上不断
	 * 被丢弃再重解码，一动就卡。屏幕外的那些根本不需要存在。
	 *
	 * 两类例外必须留着：
	 * - mounted 的（挂载窗口内、检查态、截图强制拉活的）：卸掉会连 iframe 一起卸，
	 *   bridge 注册断开，位图流水线就停在那儿了。
	 * - 选中的：选框/手柄是它「被选中」的唯一反馈，多选拖动时也要跟着动。
	 */
	const renderedFrames = useMemo(() => {
		if (!cullRect) return manifest.frames;
		return manifest.frames.filter(
			(frame) => intersects(cullRect, frame) || isMounted(frame.id) || selectedIds.includes(frame.id),
		);
	}, [manifest.frames, cullRect, isMounted, selectedIds]);

	const worldStyle = useMemo(
		() =>
			({
				transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
				transformOrigin: "0 0",
				// frame 标题与手柄按它反向缩放。走 CSS 变量而不是 prop：否则每个 wheel
				// tick 都要重渲染全部 FrameView，而这里只是改一个元素的 style。
				"--vetd-lscale": Math.min(1 / viewport.zoom, 8),
				// 刻意不加 will-change / translateZ：这一层的包围盒覆盖所有 frame，
				// 动辄上万像素，强行提升成合成层会超出 GPU 纹理上限，合成器降级后
				// 整窗口撕裂闪烁。让浏览器自己决定要不要提升。
			}) as CSSProperties,
		[viewport],
	);

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
			<div ref={worldRef} className="absolute left-0 top-0" style={worldStyle}>
				{renderedFrames.map((frame) => (
					<FrameView
						key={frame.id}
						frame={frame}
						port={port}
						getZoom={getZoom}
						bridge={bridge}
						selected={selectedIds.includes(frame.id)}
						entered={inspectFrameId === frame.id}
						interactive={tool === "select" && !panActive}
						resizable={selectedIds.length === 1}
						mounted={isMounted(frame.id)}
						live={isLive(frame.id)}
						raster={rasterOf(frame.id)}
						reloadNonce={reloadNonce}
						paintTick={paintTicks.get(frame.id) ?? 0}
						moveDelta={dragRef.current?.origins.has(frame.id) ? moveDelta : null}
						resizeRect={resizeRect?.frameId === frame.id ? resizeRect.rect : null}
						placement={layoutOverride?.get(frame.id) ?? null}
						activity={activity.get(frame.id)}
						buildError={frameErrors.get(frame.id) ?? null}
						renaming={renamingId === frame.id}
						onRenameStart={startRename}
						onRenameCommit={commitRename}
						onRenameCancel={cancelRename}
						onSelect={selectFrame}
						onContextMenu={openFrameMenu}
						onDragStart={beginDrag}
						onDragDelta={handleDragDelta}
						onDragEnd={commitDrag}
					/>
				))}
				{marquee ? (
					<div
						className="absolute border border-[var(--vetd-selected)] vetd-marquee-fill"
						style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
					/>
				) : null}
				{snapView ? <SnapGuides guides={snapView.guides} gaps={snapView.gaps} scale={1 / viewport.zoom} /> : null}
				{/* 整理工具条与 gap 手柄：多选且不在拖动/缩放中才出，免得跟正在进行的操作抢指针。 */}
				{arrangeActive && arrangeBounds ? (
					<>
						<GapHandles
							bands={gapHandles}
							scale={1 / viewport.zoom}
							active={activeGap}
							onDragStart={startGapDrag}
						/>
						<ArrangeToolbar
							bounds={arrangeBounds}
							columns={arrangeColumns}
							count={arrangeItems.length}
							onTidy={() => applyArrange(arrangeColumns)}
							onColumns={handlePickColumns}
						/>
					</>
				) : null}
			</div>

			{/* 零 frame 引导：新建的设计稿不预置任何画框（不替用户押尺寸和品类），
			    所以画布第一眼是空的——把两条出路指出来。pointer-events-none：
			    别挡住用 Frame 工具在这片区域拖框。 */}
			{manifest.frames.length === 0 ? (
				<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
					<svg
						viewBox="0 0 24 24"
						className="size-8 text-muted-foreground opacity-50"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeDasharray="3 3"
						aria-hidden
					>
						<rect x="3" y="3" width="18" height="18" rx="2" />
					</svg>
					<span className="text-sm font-medium text-foreground">{t("canvas.frames.empty.title")}</span>
					<p className="max-w-64 text-xs text-muted-foreground">{t("canvas.frames.empty.desc")}</p>
				</div>
			) : null}

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

			{!panActive && !designDrawerOpen ? (
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
				designSystemsActive={designDrawerOpen}
				faded={designDrawerOpen}
				onToolChange={setTool}
				onZoomDelta={zoomBy}
				onZoomReset={() => {
					const next = { ...viewportRef.current, zoom: 1 };
					setViewport(next);
					session.saveViewport(next);
				}}
				onExport={openExport}
				onDesignSystems={() => {
					setAskOpen(false);
					setMenuAnchor(null);
					setDesignDrawerOpen((open) => !open);
				}}
			/>

			<DesignSystemDrawer
				session={session}
				open={designDrawerOpen}
				onClose={() => setDesignDrawerOpen(false)}
			/>
		</div>
	);
}
