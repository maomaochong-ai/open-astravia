import { usePluginShortcutScope, useTranslation } from "@vetta-org/plugin-sdk";
import {
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useNotesAutoDispatch, useNotesHandoff } from "../notes/handoff";
import type { NotesStore } from "../notes/notes-store";
import { noteWorldPosition, pendingNotes } from "../notes/types";
import { getPluginCtx, notify } from "../plugin-context";
import type { DesignSession } from "../vetd/design-session";
import { classifySource, isGeneratedPath, normalizeRelative } from "../vetd/bundle-paths";
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
import { BridgeHub, type ElementQuery, type FrameWheel, type SelectedElementPayload } from "./bridge-client";
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
import { DesignSystemDialog } from "./DesignSystemDialog";
import { type FrameMenuAnchor, FrameContextMenu } from "./FrameContextMenu";
import { refreshCover } from "./cover-compose";
import { useFrameRasters } from "./frame-raster";
import { type FrameDragEdge, FrameView } from "./FrameView";
import { GapHandles } from "./GapHandles";
import { HistoryButton } from "../history/HistoryButton";
import { HistoryDrawer } from "../history/HistoryDrawer";
import type { HistoryCommit } from "../history/history-client";
import { PeekBanner } from "../history/PeekBanner";
import { enterPeek, exitPeek, type PeekState } from "../history/peek";
import { restoreDesign } from "../history/restore";
import { NOTES_PANEL_INSET, NotesDrawer } from "./NotesDrawer";
import { type NoteDraft, NotesLayer } from "./NotesLayer";
import { selectionAfterHmr } from "./selection-ask";
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
import { useViewport, type Viewport } from "./use-viewport";
import { SelectionAskBadge } from "./SelectionAskBadge";
import { SnapGuides } from "./SnapGuides";

export type CanvasSelection =
	| { kind: "frames"; ids: string[] }
	| { kind: "dom"; frameId: string; payload: SelectedElementPayload }
	| null;

/** agent 侧截图入口，见 {@link DesignCanvasProps.captureRef}。 */
export type FrameCapture = (frameId: string) => Promise<string>;

interface DesignCanvasProps {
	session: DesignSession;
	/** 当前设计的备注（与 session 同生命周期，CanvasTab 创建）。 */
	notes: NotesStore;
	/** 活动面板的 cwd，备注面板的「让 Vetta 处理」会话闸口用。 */
	cwd: string | null;
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
	/**
	 * 出口：预览按钮问「该预览哪一帧」。单独选中一个就是它，否则交给调用方回落
	 * （画布顺序里的第一帧）。
	 */
	previewTargetRef: RefObject<(() => string | null) | null>;
	/**
	 * 预览窗口开着。背后的画布整体降为位图——反正被盖住了，没必要继续养 N 份
	 * 活体 React 应用与 HMR 连接。
	 */
	previewing: boolean;
	/**
	 * 出口：vetd_notes 的锚点保鲜。拉活体后按 domPath/坐标逐条查元素，
	 * 与 captureRef 同型（runLive 只存在于本组件）。
	 */
	resolveNoteElementsRef: RefObject<
		((frameId: string, queries: ElementQuery[]) => Promise<(SelectedElementPayload | null)[]>) | null
	>;
	/** 顶栏开关的当前值：备注气泡在不在画布上。 */
	notesVisible: boolean;
	/** 自动显示备注（只开不关）：切到备注工具、落下一条备注、从列表定位到某条。 */
	showNotes(): void;
}

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Below this the marquee counts as a click, not a drag. */
const MARQUEE_MIN = 4;
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
export function byCanvasOrder(a: VetdFrameEntry, b: VetdFrameEntry): number {
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

/** 位图变化后隔多久合成封面：等一批 frame 都落定，不为每张图各合成一次。 */
const COVER_REFRESH_DEBOUNCE_MS = 1500;
/** 查看模式横幅的高度，右上角的历史按钮与面板据此让位。 */
const PEEK_BANNER_HEIGHT = 40;

export function DesignCanvas({
	session,
	notes,
	cwd,
	port,
	bridge,
	captureRef,
	refreshRef,
	previewTargetRef,
	previewing,
	resolveNoteElementsRef,
	notesVisible,
	showNotes,
}: DesignCanvasProps) {
	const { t } = useTranslation();
	const [manifest, setManifest] = useState<VetdManifest>(session.manifest);
	// 下面那些交给 FrameView 的回调必须引用稳定（memo 的前提），所以它们读 ref 而不是
	// 闭包捕获随渲染变化的 state。
	const manifestRef = useRef(manifest);
	manifestRef.current = manifest;
	const [tool, setTool] = useState<CanvasTool>("select");
	const toolRef = useRef(tool);
	toolRef.current = tool;
	const [spaceHeld, setSpaceHeld] = useState(false);
	/** 备注放置草稿（点了画布、输入框开着）与点开的备注 thread。 */
	const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
	const noteDraftRef = useRef(noteDraft);
	noteDraftRef.current = noteDraft;
	const [openNoteId, setOpenNoteId] = useState<string | null>(null);
	const openNoteIdRef = useRef(openNoteId);
	openNoteIdRef.current = openNoteId;
	const [selection, setSelection] = useState<CanvasSelection>(null);
	const selectionRef = useRef(selection);
	selectionRef.current = selection;
	/** 追问 popover 开着。开着期间选中被钉住（见 onHmrUpdated），不能被热更新清掉。 */
	const [askOpen, setAskOpen] = useState(false);
	const askOpenRef = useRef(askOpen);
	askOpenRef.current = askOpen;
	const [activity, setActivity] = useState<ReadonlyMap<string, FrameActivity>>(new Map());
	/** 错误态存在 design-runtime（agent 工具也要读），这里只订阅它来渲染。 */
	const [frameErrors, setFrameErrors] = useState<ReadonlyMap<string, string>>(new Map());
	const [marquee, setMarquee] = useState<Rect | null>(null);
	/** 设计体系选择 Dialog（与会话里那张选择卡同一个宫格）。 */
	const [designDialogOpen, setDesignDialogOpen] = useState(false);
	/** 版本历史抽屉。与备注抽屉分居两侧，可以同时开着。 */
	const [historyOpen, setHistoryOpen] = useState(false);
	/** 正在查看的旧版本。非 null 时画布上装的是那一版的内容，不是最新的。 */
	const [peek, setPeek] = useState<PeekState | null>(null);
	const [peekBusy, setPeekBusy] = useState(false);

	/**
	 * 查看/退出/恢复共用的收尾：置忙、出错报到界面上。
	 *
	 * 这层 catch 不是可选的。这些动作全在异步链里，漏掉它时一次失败的表现是「点了
	 * 没有任何反应」——按钮看起来坏了，而控制台之外没有任何线索。
	 */
	/**
	 * 查看/恢复是把整份内容换掉，不能指望「按 mtime 比对 + HMR」那条增量路径：
	 * 已经挂着的 iframe src 不变、浏览器不会重新加载，位图化的那些也未必被判成变了。
	 * 实测表现就是画布纹丝不动，一直显示旧的那一版。所以走硬重载。
	 */
	const runPeekAction = async (action: () => Promise<void>): Promise<void> => {
		setPeekBusy(true);
		try {
			await action();
		} catch (error) {
			console.error("[vetta-ui-design] 查看历史版本失败", error);
			notify({ variant: "error", message: t("history.peek.failed"), error });
		} finally {
			setPeekBusy(false);
		}
	};
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
	/**
	 * 当前允许渲染的世界矩形（可见区域 + CULL_MARGIN_SCREENS 屏预留）。null 表示还
	 * 没量到容器尺寸，那时不裁剪。
	 */
	const [cullRect, setCullRect] = useState<Rect | null>(null);
	const cullRectRef = useRef<Rect | null>(null);
	cullRectRef.current = cullRect;

	/**
	 * 按当前视口更新裁剪矩形。够用就原地不动——这个函数在平移的每一帧、缩放的每个
	 * wheel tick 都会被调用，每次都 setState 等于把「绕开 React」的努力还回去。
	 *
	 * 两种情况才重算：
	 * - 余量不足半屏：接着平移/缩小就要露出没渲染的区域了。
	 * - 范围比需要的大一倍以上：放大之后旧矩形还按老比例留着，会一直多渲染一堆 frame。
	 */
	const syncCullRect = useCallback((vp: Viewport, size: { width: number; height: number }): void => {
		const { width, height } = size;
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

	/**
	 * 视口（平移/缩放）全托管给共享控制器，只读预览画布用的是同一份实现。
	 * 这里额外挂 onPaint：平移的每一帧都要按新的可见范围核对裁剪矩形。
	 */
	const view = useViewport({
		initial: { ...session.manifest.canvas },
		onCommit: (next) => session.saveViewport(next),
		onPaint: syncCullRect,
	});
	const { viewport, viewportRef, containerRef, worldRef, sizeRef, toWorld } = view;

	// 缩放、平移落定：都要按新的可见范围核对一次裁剪范围（尺寸变化由 onPaint 覆盖）。
	useEffect(() => {
		syncCullRect(viewport, sizeRef.current);
	}, [viewport, syncCullRect, sizeRef]);

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
	const inspectFrameId = tool === "select" && !panActive && !previewing ? activeFrameId : null;

	previewTargetRef.current = () => activeFrameId;

	/**
	 * 位图化时「必须保持活体」的那一帧。预览开着时一帧都不留：画布整个被盖住，
	 * 唯一在看的渲染树是预览窗口里那一份。
	 */
	const liveFrameId = previewing ? null : activeFrameId;

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
		notifyRendered,
		runLive,
		withCaptureLock,
		refreshAll,
		reloadAll,
		reloadNonce,
	} = useFrameRasters({
		bridge,
		cacheKey: session.vetdPath,
		frameIds: orderedFrameIds,
		activeFrameId: liveFrameId,
		offscreen: {
			port,
			sizeOf: (frameId) => {
				const frame = manifest.frames.find((candidate) => candidate.id === frameId);
				return frame ? { width: frame.width, height: frame.height } : null;
			},
		},
	});

	refreshRef.current = reloadAll;

	/**
	 * 位图安静下来之后合成一次画廊封面。
	 *
	 * 不能只在画布卸载时合成：那与画廊的挂载是竞态——用户从画布切到画廊，合成还在
	 * 解码 jpeg，画廊已经读过一次库了，于是「明明进过画布」却看不到封面。趁画布还
	 * 开着先把封面写好，卸载时那次就只是补最后一版。
	 *
	 * 依赖 rasterOf 的引用：它随位图集合变化（useCallback over rasters），所以一批
	 * frame 连续落定只会在末尾合成一次，而不是每张图合成一次。
	 */
	useEffect(() => {
		const timer = window.setTimeout(() => {
			void refreshCover(session.vetdPath, manifest.frames);
		}, COVER_REFRESH_DEBOUNCE_MS);
		return () => window.clearTimeout(timer);
	}, [rasterOf, manifest.frames, session.vetdPath]);

	/**
	 * 备注锚定的元素查询：位图态的 frame 先经 runLive 拉回活体，再逐条问引擎 bridge。
	 * 放置时的 hit-test 与 vetd_notes 的锚点保鲜共用这一条。
	 */
	const resolveNoteElements = useCallback(
		(frameId: string, queries: ElementQuery[]): Promise<(SelectedElementPayload | null)[]> =>
			runLive(frameId, async () => {
				const results: (SelectedElementPayload | null)[] = [];
				for (const query of queries) results.push(await bridge.resolveElement(frameId, query));
				return results;
			}),
		[bridge, runLive],
	);

	useEffect(() => {
		resolveNoteElementsRef.current = resolveNoteElements;
		return () => {
			resolveNoteElementsRef.current = null;
		};
	}, [resolveNoteElementsRef, resolveNoteElements]);

	// 面板「定位到备注」：视口居中到气泡上，顺带打开它的 thread。
	const focusNote = useCallback(
		(noteId: string): void => {
			const note = notes.noteById(noteId);
			if (!note) return;
			const pos = noteWorldPosition(note, (frameId) => manifestRef.current.frames.find((f) => f.id === frameId));
			const { width, height } = sizeRef.current;
			const zoom = viewportRef.current.zoom;
			// 定位只由面板里的条目发起，那时面板一定开着：按它让出的可见区域（面板右边
			// 那块）居中，否则「居中」正好把气泡送到面板底下。
			const visibleWidth = Math.max(width - NOTES_PANEL_INSET, width * 0.35);
			view.commitViewport({ zoom, x: width - visibleWidth / 2 - pos.x * zoom, y: height / 2 - pos.y * zoom });
			// 定位到一个被隐藏的气泡等于把视口挪到空白处：先把备注层拉回来。
			showNotes();
			setOpenNoteId(noteId);
		},
		[notes, view, sizeRef, viewportRef, showNotes],
	);

	/** 待处理备注数，挂在 ControlBar 备注按钮的角标上。 */
	const [pendingNoteCount, setPendingNoteCount] = useState(0);
	useEffect(() => {
		const update = (): void => setPendingNoteCount(pendingNotes(notes.notes).length);
		update();
		const handle = notes.on(update);
		return () => handle.dispose();
	}, [notes]);

	// 快捷键 c 切到备注工具。走宿主 ShortcutScopeStack（不裸挂 keydown），
	// not-editable：备注输入框里打字母 c 不能把工具切走。
	const registerShortcutScope = useMemo(() => {
		const ui = getPluginCtx().ui;
		return ui.registerShortcutScope.bind(ui);
	}, []);
	usePluginShortcutScope(registerShortcutScope, {
		id: "note-tool",
		kind: "surface",
		bindings: [{ key: "c", when: "not-editable", run: () => setTool("note") }],
	});

	// 切离备注工具就收掉没提交的草稿；换设计时 thread 弹层也一并收掉。
	// 切到备注工具则自动显示备注层：这个工具下要做的每件事都得先看得见气泡。
	useEffect(() => {
		if (tool === "note") showNotes();
		else setNoteDraft(null);
	}, [tool, showNotes]);
	useEffect(() => {
		setNoteDraft(null);
		setOpenNoteId(null);
	}, [session]);

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
				const rel = normalizeRelative(file.relPath);
				const impact = classifySource(rel);
				if (impact.kind === "none") continue;
				const stat = await ctx.fs.stat(file.path).catch(() => null);
				if (!stat) continue;
				const previous = sourceMtimesRef.current.get(rel);
				sourceMtimesRef.current.set(rel, stat.modifiedAt);
				if (seedOnly || previous === undefined || previous === stat.modifiedAt) continue;
				// 影响面判定与活动态浮层共用（vetd/bundle-paths），两边不能有两套说法。
				if (impact.kind === "frame") changedFrames.add(impact.frameId);
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
					.filter((entry) => entry.isDirectory && !isGeneratedPath(`${entry.name}/`))
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
	 * 右击 frame 弹菜单。菜单里的动作（重命名 / 复制为图片 / 导出渲染图）按当前选中执行，
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
				if (!frameId) return;
				invalidateRaster(frameId);
				setSelection((current) => selectionAfterHmr(current, frameId, askOpenRef.current));
			},
			onRendered: (frameId) => {
				// rendered 既是「可以截图了」的放行信号，也是「已截的图可能是渲染前
				// 截的」的作废信号，两件事都在 notifyRendered 里。
				notifyRendered(frameId);
				// 同一条信号还负责位图→活体的交接：计数自增，FrameView 拿它判断
				// 「这一次挂载之后画面已经出来了」。
				setPaintTicks((current) => new Map(current).set(frameId, (current.get(frameId) ?? 0) + 1));
			},
			onFrameError: setFrameError,
			onFrameContextMenu: openFrameMenu,
			// frame 内的滚轮与空格：跨源 iframe 把事件全吃了，画布容器上的监听收不到，
			// 缩放/平移只能从这条路进来。
			onFrameWheel: view.applyWheel,
			onFrameSpace: setSpaceHeld,
		});
		return () => bridge.stop();
	}, [bridge, invalidateRaster, notifyRendered, openFrameMenu, view.applyWheel]);

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
			// 画布里的输入框（frame 重命名）也在这个容器内，事件会冒泡上来。
			// 不放行的话空格会被 preventDefault 掉（打不出空格），Esc 也会顺带清空选中。
			const target = event.target as HTMLElement | null;
			if (target && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
				return;
			}
			if (event.code === "Space" && !event.repeat) {
				event.preventDefault();
				setSpaceHeld(true);
			} else if (event.key === "Escape") {
				// 备注态优先逐级退出：草稿 → thread 弹层 → 备注工具本身。
				if (noteDraftRef.current) {
					setNoteDraft(null);
				} else if (openNoteIdRef.current) {
					setOpenNoteId(null);
				} else if (toolRef.current === "note") {
					setTool("select");
				} else {
					// 焦点在画布上时的 Esc（元素选中期间焦点在 iframe 里，那时 Esc 由引擎侧
					// 处理：逐级选父元素，到顶再发 exit-inspect 把元素选中清掉）。
					// 到这里就是最后一级：取消 frame 选中。
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
	}, []);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const onWheel = (event: WheelEvent): void => {
			event.preventDefault();
			view.applyWheel(event);
		};
		container.addEventListener("wheel", onWheel, { passive: false });
		return () => container.removeEventListener("wheel", onWheel);
	}, [view.applyWheel]);

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
			view.beginPan(event.pointerId, event.clientX, event.clientY);
			return;
		}
		// 备注工具：点哪儿就在哪儿出草稿输入框（frame 上命中就锚 frame，空白处是自由
		// 备注）。frame 上的命中元素解析在后台跑，不阻塞输入；空内容提交即丢弃。
		if (tool === "note") {
			setOpenNoteId(null);
			// 备注工具下仍可手动隐藏；这一下要落的是一条新备注，落完必须看得见。
			showNotes();
			const world = toWorld(event.clientX, event.clientY);
			const hitFrame =
				[...manifestRef.current.frames]
					.reverse()
					.find(
						(frame) =>
							world.x >= frame.x &&
							world.x <= frame.x + frame.width &&
							world.y >= frame.y &&
							world.y <= frame.y + frame.height,
					) ?? null;
			if (hitFrame) {
				const fx = Math.round(world.x - hitFrame.x);
				const fy = Math.round(world.y - hitFrame.y);
				setNoteDraft({
					world: { x: Math.round(world.x), y: Math.round(world.y) },
					frameId: hitFrame.id,
					fx,
					fy,
					hit: resolveNoteElements(hitFrame.id, [{ x: fx, y: fy }])
						.then((results) => results[0] ?? null)
						.catch(() => null),
				});
			} else {
				setNoteDraft({ world: { x: Math.round(world.x), y: Math.round(world.y) }, frameId: null, fx: 0, fy: 0, hit: null });
			}
			return;
		}
		// 空白处起手（框选/新建）时点开的备注 thread 让位。
		setOpenNoteId(null);
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
		// 平移只改外层那一个 transform，不进 state（见 use-viewport）。
		if (view.panMove(event.pointerId, event.clientX, event.clientY)) return;
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
		if (view.endPan(event.pointerId)) return;
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
	 *
	 * 交付物这条路曾经开着 cacheBust 兜「素材缓存缺 CORS 头」，实测三条都不成立：
	 * 缺 CORS 头的图开着它照样内联不进来；html-to-image 把内联结果按*去掉 query 的*
	 * URL 缓存，cacheBust 加的随机串进不了 key，缓存在它生效前就短路了——连失败结果
	 * 都会被这么缓存住，所以拿它做重试兜底也没用。代价倒是实打实：30 张图 81ms→824ms，
	 * 80 张图 126ms→2272ms（本地服务器、单张 150ms 延迟；线上 CDN 只会更糟）。
	 * 一个从没兑现过的兜底不值这个价，关掉。
	 */
	const captureFaithfully = useCallback(
		(frameId: string, options?: { keepHighlight?: boolean; pixelRatio?: number }): Promise<string> =>
			// 锁在最外层：runLive 的拉活体 + 静置也算这次截图的一部分，放进去等于让后台
			// 队列在这段时间里插一张进来，撞的还是同一个 iframe。
			withCaptureLock(() => runLive(frameId, () => bridge.capture(frameId, { ...options, timeoutMs: 30_000 }))),
		[bridge, runLive, withCaptureLock],
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

	/**
	 * 追问徽标与备注面板共用同一套会话闸口：能发消息就直接发，发不了（agent 在跑、
	 * 没有活跃会话、会话不在这个 workspace）就落一条备注。
	 */
	const { blockedReason } = useNotesHandoff(cwd);

	/**
	 * 备注自动派活：只要会话空闲，落下的备注就自己交给 agent。用户不必再去点「让
	 * Vetta 处理」——那个按钮退居兜底。
	 */
	useNotesAutoDispatch(notes, cwd);

	// 选中变了就收起 popover：它描述的是上一次选中，留着只会发错对象。
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只按选中变化收起
	useEffect(() => setAskOpen(false), [selection]);

	/**
	 * 追问提交完成，收起选中：两种提交都会在选框右上角长出一个备注气泡，也就是徽标
	 * 刚才的位置，不清掉就是两个圆叠在一起。要补充的话点那个气泡在 thread 里追加，
	 * 补充的内容还能跟原请求归在同一条线上。
	 */
	const handleAskSubmitted = useCallback((): void => {
		setAskOpen(false);
		setSelection(null);
		// 追问落的就是一条备注：刚提交完却看不到它，等于什么都没发生。
		showNotes();
	}, [showNotes]);

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

	const cursor = panActive ? "grab" : tool === "frame" || tool === "note" ? "crosshair" : "default";

	/**
	 * 整理相关的浮层出不出。拖动/改尺寸期间收起来：那时选区每帧都在动，工具条跟着
	 * 抖不说，gap 手柄还会去抢正在拖拽的指针。
	 */
	const arrangeActive =
		selectedIds.length >= 2 && tool === "select" && !panActive && moveDelta === null && resizeRect === null;

	/**
	 * 追问徽标出不出。抗噪条件与整理工具条同源：拖动/改尺寸/平移期间选框每帧都在动，
	 * 徽标跟着抖不说，还会去抢正在进行的指针。
	 */
	const askActive =
		selectedIds.length === 1 &&
		tool === "select" &&
		!panActive &&
		!previewing &&
		moveDelta === null &&
		resizeRect === null;

	// 徽标都不在了就别留一个悬空的 popover。
	useEffect(() => {
		if (!askActive) setAskOpen(false);
	}, [askActive]);

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
				transform: view.worldTransform,
				transformOrigin: "0 0",
				// frame 标题与手柄按它反向缩放。走 CSS 变量而不是 prop：否则每个 wheel
				// tick 都要重渲染全部 FrameView，而这里只是改一个元素的 style。
				"--vetd-lscale": Math.min(1 / viewport.zoom, 8),
				// 刻意不加 will-change / translateZ：这一层的包围盒覆盖所有 frame，
				// 动辄上万像素，强行提升成合成层会超出 GPU 纹理上限，合成器降级后
				// 整窗口撕裂闪烁。让浏览器自己决定要不要提升。
			}) as CSSProperties,
		[view.worldTransform, viewport.zoom],
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
				<NotesLayer
					store={notes}
					frames={manifest.frames}
					interactive={(tool === "select" || tool === "note") && !panActive && !previewing}
					visible={notesVisible}
					draft={noteDraft}
					blockedReason={blockedReason}
					onDraftClose={() => setNoteDraft(null)}
					openNoteId={openNoteId}
					onOpenNote={setOpenNoteId}
					getZoom={getZoom}
				/>
				{/* 选框右上角的追问徽标：单选（一个画框、或画框里的一个元素）时才有。 */}
				<SelectionAskBadge
					notes={notes}
					selection={selection}
					frames={manifest.frames}
					visible={askActive}
					blockedReason={blockedReason}
					open={askOpen}
					onOpenChange={setAskOpen}
					onSubmitted={handleAskSubmitted}
				/>
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

			{/* 备注面板与备注工具是同一个状态：选中工具即弹出，切走即收起，
			    所以它没有独立的开关，关闭按钮做的也是「退回选择工具」。 */}
			{tool === "note" ? (
				<NotesDrawer
					store={notes}
					session={session}
					cwd={cwd}
					onLocate={focusNote}
					onClose={() => setTool("select")}
				/>
			) : null}

			<HistoryButton
				open={historyOpen}
				offsetTop={peek ? PEEK_BANNER_HEIGHT : 0}
				onToggle={() => setHistoryOpen((open) => !open)}
			/>

			{peek ? (
				<PeekBanner
					title={peek.title}
					busy={peekBusy}
					onExit={() => {
						void runPeekAction(async () => {
							await exitPeek(getPluginCtx(), session);
							setPeek(null);
							reloadAll();
						});
					}}
					onRestore={() => {
						void runPeekAction(async () => {
							// 先退出再恢复：工作区此刻装的是旧版本，直接恢复会把它当成「现场」
							// 封存下来，历史里多出一个内容等于旧版的假版本。
							await exitPeek(getPluginCtx(), session);
							await restoreDesign(getPluginCtx(), session.dirPath, { ...peek, timestamp: 0, files: [] }, { session });
							setPeek(null);
							reloadAll();
						});
					}}
				/>
			) : null}

			{historyOpen ? (
				<HistoryDrawer
					session={session}
					peekSha={peek?.sha ?? null}
					onPeek={(target: HistoryCommit) => {
						void runPeekAction(async () => {
							const state = await enterPeek(getPluginCtx(), session, target);
							if (!state) {
								// 唯一会走到这里的正常情况是「目标就是当前版本」，此时确实无事
								// 可做；但静默返回会让按钮看起来是坏的，所以说一句。
								notify({ variant: "info", message: t("history.peek.alreadyCurrent") });
								return;
							}
							setPeek(state);
							reloadAll();
						});
					}}
					onRestored={reloadAll}
					offsetTop={peek ? PEEK_BANNER_HEIGHT : 0}
					onClose={() => setHistoryOpen(false)}
				/>
			) : null}

			<ControlBar
				tool={tool}
				zoom={viewport.zoom}
				exportableCount={orderedSelection.length}
				designSystemsActive={designDialogOpen}
				pendingNotes={pendingNoteCount}
				onToolChange={setTool}
				onZoomDelta={view.zoomBy}
				onZoomReset={() => {
					view.commitViewport({ ...viewportRef.current, zoom: 1 });
				}}
				onExport={openExport}
				onDesignSystems={() => {
					setMenuAnchor(null);
					setDesignDialogOpen((open) => !open);
				}}
			/>

			<DesignSystemDialog
				session={session}
				open={designDialogOpen}
				onClose={() => setDesignDialogOpen(false)}
			/>
		</div>
	);
}
