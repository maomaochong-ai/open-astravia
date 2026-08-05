import { useTranslation } from "@vetta-org/plugin-sdk";
import { memo, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { frameUrl } from "../vetd/frame-url";
import type { VetdFrameEntry } from "../vetd/manifest-types";
import type { BridgeHub } from "./bridge-client";
import type { FrameActivity } from "./design-runtime";
import { FrameTitleInput } from "./FrameTitleInput";

type ResizeEdge = "nw" | "ne" | "sw" | "se" | "e" | "s";
/** 一次拖拽在改什么：整体位置，还是某条边/某个角。 */
export type FrameDragEdge = ResizeEdge | "move";

/**
 * 回调一律 frameId 优先、且由画布侧用 useCallback 固定住引用。
 *
 * 这不是风格问题：FrameView 走 memo，任何一个内联箭头函数（`() => selectFrame(frame.id)`）
 * 都会让每次画布重渲染都变成「全部 N 个 frame 重渲染」，memo 直接失效。
 */
interface FrameViewProps {
	frame: VetdFrameEntry;
	port: number;
	/**
	 * 读当前缩放。改尺寸/移动要把指针位移换算成世界位移，需要 zoom；但不能作为 prop
	 * 下发——那样每个 wheel tick 都会重渲染所有 frame。视觉上的反向缩放走 CSS 变量
	 * `--vetd-lscale`（由画布在 world 层上设置）。
	 */
	getZoom(): number;
	bridge: BridgeHub;
	selected: boolean;
	/**
	 * 元素选择开着：画面区的指针事件直接交给 iframe。单独选中这个 frame 时就是 true，
	 * 所以 frame 自身的移动改走标题栏、缩放走四角手柄（手柄不随它隐藏）。
	 */
	entered: boolean;
	interactive: boolean;
	/** Resize handles show only for a lone selection — a group resize has no obvious meaning. */
	resizable: boolean;
	/** false 时连 iframe 都还没挂（启动期的挂载节流），见 frame-raster.ts。 */
	mounted: boolean;
	/** false 时 iframe 收成 display:none，改用 `raster` 位图显示。 */
	live: boolean;
	raster: string | null;
	/** 变化时 iframe 的 URL 跟着变，强制它重新导航（刷新按钮走这条路）。 */
	reloadNonce: number;
	/**
	 * 该 frame 累计上报「已经画到屏幕上」的次数。位图向活体的交接必须等它自增，
	 * 不能用 iframe 的 onLoad——文档 load 远早于 React 应用渲染完（dev 下还要拉
	 * module graph、再 lazy 载入 frame chunk），那时切过去看到的是白板。
	 */
	paintTick: number;
	/** Live offset of the in-flight group move this frame takes part in. */
	moveDelta: { dx: number; dy: number } | null;
	/** 正在改尺寸时的实时矩形（由画布算出，含吸附与最小尺寸钳制）。 */
	resizeRect: { x: number; y: number; width: number; height: number } | null;
	/** 排列预览（拖 gap 期间）覆盖的位置，非 null 时压过 manifest 里的 x/y。 */
	placement: { x: number; y: number } | null;
	activity: FrameActivity | undefined;
	/** 非 null 时这一帧编译/渲染失败：盖住上一张位图，标题栏挂徽标（详情走 title）。 */
	buildError: string | null;
	/** true 时标题变成就地编辑的输入框（双击标题，或右键菜单里的重命名）。 */
	renaming: boolean;
	onSelect(frameId: string, additive: boolean): void;
	/** 右键：坐标是视口坐标（clientX/Y），由画布换算成容器内坐标定位菜单。 */
	onContextMenu(frameId: string, clientX: number, clientY: number): void;
	onRenameStart(frameId: string): void;
	/** 提交由画布落盘；标题没变或为空时画布自行忽略。 */
	onRenameCommit(frameId: string, title: string): void;
	onRenameCancel(): void;
	/**
	 * 拖拽的几何全归画布：移动要让整个选中集一起走，改尺寸要拿到旁边 frame 才能吸附，
	 * 两件事这一层都做不了。这里只管指针，位移原样上报（世界单位、不取整，取整与吸附
	 * 由画布决定），结果经 moveDelta / resizeRect 回来。
	 */
	onDragStart(frameId: string, edge: FrameDragEdge, additive: boolean): void;
	onDragDelta(dx: number, dy: number, bypassSnap: boolean): void;
	onDragEnd(): void;
}

interface DragState {
	pointerId: number;
	startX: number;
	startY: number;
	edge: FrameDragEdge;
}

/**
 * 收不到「画好了」信号时的兜底：iframe 加载完这么久之后照样交接。引擎渲染不出内容
 * （bridge 没装上、frame 抛错在边界里）时不能让位图永远盖着。
 */
const PAINT_FALLBACK_MS = 2_500;

/**
 * memo 是这层的性能前提：画布上任何一次状态变化（框选矩形、活动态、截图上报、
 * 缩放…）都会重渲染 DesignCanvas，N 个 frame 只应该做 N 次浅比较而不是 N 次
 * 重渲染。前提是 props 全都稳定——见 {@link FrameViewProps}。
 */
export const FrameView = memo(function FrameView({
	frame,
	port,
	getZoom,
	bridge,
	selected,
	entered,
	interactive,
	resizable,
	mounted,
	live,
	raster,
	reloadNonce,
	paintTick,
	moveDelta,
	resizeRect,
	placement,
	activity,
	buildError,
	renaming,
	onSelect,
	onContextMenu,
	onRenameStart,
	onRenameCommit,
	onRenameCancel,
	onDragStart,
	onDragDelta,
	onDragEnd,
}: FrameViewProps) {
	const { t } = useTranslation();
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const dragRef = useRef<DragState | null>(null);
	/**
	 * 正在拖拽。用来让遮罩在这段时间里保持可交互：从未选中态起手拖动会顺带选中这个
	 * frame，遮罩本该立刻让位给 iframe，但那样松手事件就落空了，这一次拖拽再也结束
	 * 不了。拖到松手为止都留着。
	 */
	const [dragging, setDragging] = useState(false);
	/** 当前这个 iframe 是否已经把内容画出来了——位图要盖到这一刻才撤。 */
	const [loaded, setLoaded] = useState(false);
	/** 交接只认「这一次挂载之后」的上报，所以要记下挂载时刻的计数基线。 */
	const paintTickRef = useRef(paintTick);
	paintTickRef.current = paintTick;
	const paintBaselineRef = useRef(paintTick);
	const fallbackRef = useRef<number | null>(null);

	// 卸载后再挂上是一个全新的 iframe，加载态要跟着重置，否则位图会提前撤掉。
	// 刷新（reloadNonce 变化）同理：正在重新导航的这段时间该由位图盖住。
	useEffect(() => {
		paintBaselineRef.current = paintTickRef.current;
		// 上一个 iframe 留下的兜底计时器要一起作废，否则它会在新 iframe 还空白时
		// 把 loaded 拉回 true，白闪原样回来。
		if (fallbackRef.current !== null) {
			window.clearTimeout(fallbackRef.current);
			fallbackRef.current = null;
		}
		setLoaded(false);
	}, [mounted, reloadNonce]);

	useEffect(() => {
		if (paintTick > paintBaselineRef.current) setLoaded(true);
	}, [paintTick]);

	useEffect(() => {
		return () => {
			if (fallbackRef.current !== null) window.clearTimeout(fallbackRef.current);
		};
	}, []);

	/**
	 * 已经画得出来的那张位图。img 在解码完成前是完全透明的，这时候把 iframe 收掉
	 * 就会露出容器白底——切回位图时的白闪正是这么来的（位图越大越明显）。
	 * frame-raster 侧已经预解码过一轮，这里是第二道保险：真画出来了才撤活体。
	 */
	const [paintedRaster, setPaintedRaster] = useState<string | null>(null);
	const rasterPainted = raster !== null && paintedRaster === raster;

	const shouldShowRaster = !live || !loaded || buildError !== null;
	/** 活体要多留一会儿：位图还没画出来时它是唯一有内容的那一层。 */
	const keepLiveVisible = live || (raster !== null && !rasterPainted);

	// mounted 必须在依赖里：iframe 是按挂载节流条件渲染的，false→true 时这个
	// effect 要重跑才能把真正的 iframe 注册进 bridge。漏了它的话，后挂上的 frame
	// 发出的 rendered / captured 消息认不出 frameId，截图队列会永远卡在原地。
	useEffect(() => {
		bridge.register(frame.id, iframeRef.current);
		return () => bridge.register(frame.id, null);
	}, [bridge, frame.id, mounted]);

	const rect = resizeRect ?? {
		x: (placement?.x ?? frame.x) + (moveDelta?.dx ?? 0),
		y: (placement?.y ?? frame.y) + (moveDelta?.dy ?? 0),
		width: frame.width,
		height: frame.height,
	};

	const beginDrag = (event: ReactPointerEvent, edge: DragState["edge"]): void => {
		// 只认左键：右键要留给上下文菜单，捕获指针会把后续事件都劫走。
		if (event.button !== 0) return;
		// 这里不能再拦 entered：元素选择开着时画面区已经归 iframe，标题栏和四角手柄
		// 就是移动/缩放仅剩的入口，拦掉等于选中之后 frame 再也动不了。
		if (!interactive) return;
		event.preventDefault();
		event.stopPropagation();
		onDragStart(frame.id, edge, event.shiftKey);
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		setDragging(true);
		dragRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			edge,
		};
	};

	const moveDrag = (event: ReactPointerEvent): void => {
		const drag = dragRef.current;
		if (!drag || event.pointerId !== drag.pointerId) return;
		// 按键早就松开了却还在收到移动，说明那次 pointerup 落到了别处（跨源 iframe 里
		// 松手、起手的元素中途没了…）。就地收尾，别让 frame 继续跟着指针跑。
		if (event.buttons === 0) {
			finishDrag(event.pointerId);
			return;
		}
		const zoom = getZoom();
		// 不取整：整数化与吸附都在画布侧，命中吸附时结果可能带小数（中线对齐）。
		onDragDelta(
			(event.clientX - drag.startX) / zoom,
			(event.clientY - drag.startY) / zoom,
			event.metaKey || event.ctrlKey,
		);
	};

	const finishDrag = (pointerId: number): void => {
		const drag = dragRef.current;
		if (!drag || pointerId !== drag.pointerId) return;
		dragRef.current = null;
		setDragging(false);
		onDragEnd();
	};

	const endDrag = (event: ReactPointerEvent): void => finishDrag(event.pointerId);

	/**
	 * 兜底收尾：拖拽起手的那个元素有可能在松手之前就消失（例如按下遮罩会让 frame
	 * 变成选中态，遮罩本身随之让位给 iframe），它的 pointerup 就永远不会来。
	 * dragRef 于是一直留着上一次的按下点，而它是遮罩和标题栏共用的——鼠标之后只要
	 * 飘过标题栏就会被当成还在拖，frame 跟着指针跑。这里在 window 上补一次收尾。
	 */
	const finishRef = useRef(finishDrag);
	finishRef.current = finishDrag;
	useEffect(() => {
		const onWindowUp = (event: PointerEvent): void => finishRef.current(event.pointerId);
		window.addEventListener("pointerup", onWindowUp);
		window.addEventListener("pointercancel", onWindowUp);
		return () => {
			window.removeEventListener("pointerup", onWindowUp);
			window.removeEventListener("pointercancel", onWindowUp);
		};
	}, []);

	/**
	 * 标题栏与手柄的反向缩放。取值由画布在 world 层上写成 CSS 变量，这里只是引用
	 * 它——所以缩放画布不会让这个组件重渲染，浏览器自己重算 transform。
	 */
	const labelScale = "var(--vetd-lscale, 1)";
	const handles: { edge: ResizeEdge; className: string }[] = [
		{ edge: "nw", className: "-left-1 -top-1 cursor-nwse-resize" },
		{ edge: "ne", className: "-right-1 -top-1 cursor-nesw-resize" },
		{ edge: "sw", className: "-bottom-1 -left-1 cursor-nesw-resize" },
		{ edge: "se", className: "-bottom-1 -right-1 cursor-nwse-resize" },
		{ edge: "e", className: "-right-1 top-1/2 -translate-y-1/2 cursor-ew-resize" },
		{ edge: "s", className: "-bottom-1 left-1/2 -translate-x-1/2 cursor-ns-resize" },
	];

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: canvas manipulation surface
		<div
			className="absolute"
			style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
			data-vetd-frame={frame.id}
			// 标题栏、遮罩、手柄都在这层里，右键落在 frame 任意处都算命中。检查态下
			// 事件被跨源 iframe 吃掉，那时本来就该用 iframe 自己的菜单。
			onContextMenu={(event) => {
				if (!interactive) return;
				event.preventDefault();
				event.stopPropagation();
				onContextMenu(frame.id, event.clientX, event.clientY);
			}}
		>
			{/* Title bar (inverse-scaled so it stays readable at any zoom). */}
			<div
				className="absolute left-0 flex items-center gap-1.5 whitespace-nowrap text-xs"
				style={{
					transform: `scale(${labelScale})`,
					transformOrigin: "left bottom",
					bottom: "100%",
					marginBottom: `calc(4px * ${labelScale})`,
				}}
			>
				{renaming ? (
					<FrameTitleInput
						initial={frame.title || frame.id}
						onCommit={(title) => onRenameCommit(frame.id, title)}
						onCancel={onRenameCancel}
					/>
				) : (
					<button
						type="button"
						className={`cursor-pointer truncate font-medium ${
							selected ? "text-[var(--vetd-selected)]" : "text-muted-foreground"
						}`}
						onPointerDown={(event) => beginDrag(event, "move")}
						onPointerMove={moveDrag}
						onPointerUp={endDrag}
						// 双击标题是重命名（Figma 行为）；要进 frame 检查态请双击画面本身。
						onDoubleClick={() => {
							if (interactive) onRenameStart(frame.id);
						}}
						title={frame.title || frame.id}
					>
						{frame.title || frame.id}
					</button>
				)}
				<span className="text-muted-foreground">
					{Math.round(rect.width)}×{Math.round(rect.height)}
				</span>
				{buildError ? (
					<span
						className="flex items-center gap-1 rounded-full bg-red-500/15 px-1.5 py-0.5 text-red-600"
						title={buildError}
					>
						<span className="size-1.5 rounded-full bg-red-500" />
						{t("canvas.frame.buildError")}
					</span>
				) : null}
				{activity === "modifying" ? (
					<span className="flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-primary">
						<span className="size-1.5 animate-pulse rounded-full bg-primary" />
						{t("canvas.frame.modifying")}
					</span>
				) : null}
				{activity === "updated" ? (
					<span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-emerald-600">
						{t("canvas.frame.updated")}
					</span>
				) : null}
			</div>

			<div
				className={`relative h-full w-full overflow-hidden rounded-sm bg-white shadow-md ring-offset-0 ${
					selected ? "ring-2 ring-[var(--vetd-selected)]" : "ring-1 ring-border"
				} ${activity === "modifying" ? "vetd-modifying" : ""}`}
			>
				{/* 位图态下 iframe 根本不挂：留着 display:none 的 iframe 等于把整个
				    React 应用连同大图留在内存里，合成器照样吃不消。 */}
				{mounted ? (
					<iframe
						ref={iframeRef}
						title={frame.title || frame.id}
						src={frameUrl(port, frame.id, reloadNonce)}
						className="h-full w-full border-0"
						style={{
							pointerEvents: entered ? "auto" : "none",
							display: keepLiveVisible ? "block" : "none",
						}}
						// 文档 load 只用来起兜底计时：真正的交接信号是 paintTick。
						onLoad={() => {
							if (fallbackRef.current !== null) window.clearTimeout(fallbackRef.current);
							fallbackRef.current = window.setTimeout(() => setLoaded(true), PAINT_FALLBACK_MS);
						}}
					/>
				) : null}
				{/* 位图盖在 iframe 上，等它真的把内容画出来再淡出：刚挂载的 iframe 有一段
				    空白期，直接切过去就是肉眼可见的白闪。
				    只要有位图就一直挂着、单纯用 opacity 收放，两个理由：按「该不该显示」卸载
				    的话 opacity 过渡根本没机会执行，交接又变回硬切；而且活体期间摘掉 img，
				    新位图到达时收不到 onLoad，也就无从知道它已经画得出来了。
				    构建失败时也留着：iframe 里此刻只有兜底文案，上一张好图才是用户要看的。
				    pointer-events-none 是必须的：opacity 归零的元素照样是命中目标，这张图
				    盖在 iframe 上就会把点击全吃掉，元素选择直接失效。它只是一层画面。 */}
				{raster ? (
					<img
						src={raster}
						alt=""
						aria-hidden
						className="pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity"
						// 两个方向必须不对称。
						// 位图→活体：位图淡出，底下一直垫着已经画好的 iframe，200ms 过渡看不出交接。
						// 活体→位图：iframe 在同一次提交里就被卸掉了（见 frame-raster 的 mounted），
						// 淡入的这 200ms 底下什么都没有，露出的是容器白底——那一下闪白就是这么来的。
						// 位图此刻已解码、内容与活体一致，硬切反而完全看不出来。
						style={{
							opacity: shouldShowRaster ? 1 : 0,
							transitionDuration: shouldShowRaster ? "0ms" : "200ms",
						}}
						onLoad={() => setPaintedRaster(raster)}
					/>
				) : null}
				{!raster && !loaded && !buildError ? (
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-muted">
						<span className="size-4 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-transparent" />
					</div>
				) : null}
				{/* 遮罩：还没单独选中它时，画面区的点击只作用在 frame 这一层（选中/拖动）。
				    单独选中之后遮罩让位给 iframe，里面的元素直接可选。
				    注意是把指针事件关掉而不是把元素卸掉：起手拖动会顺带选中这个 frame，
				    卸掉的话这一次拖拽的 pointerup 就丢了，dragRef 泄漏，之后鼠标飘过标题栏
				    frame 就跟着指针跑。拖拽期间（dragging）无论如何都保持可交互。 */}
				{
					// biome-ignore lint/a11y/noStaticElementInteractions: canvas manipulation surface
					<div
						className="absolute inset-0"
						style={{
							cursor: interactive ? "default" : "inherit",
							pointerEvents: entered && !dragging ? "none" : "auto",
						}}
						onPointerDown={(event) => beginDrag(event, "move")}
						onPointerMove={moveDrag}
						onPointerUp={endDrag}
						// 多选态下双击某一个 frame：收敛成只选它，也就直接开了元素选择。
						onDoubleClick={(event) => {
							event.stopPropagation();
							if (interactive) onSelect(frame.id, false);
						}}
					/>
				}
			</div>

			{/* 手柄在元素选择开着时也要留：画面区已经归 iframe 了，缩放只剩这一条路。 */}
			{selected && resizable
				? handles.map(({ edge, className }) => (
						// biome-ignore lint/a11y/noStaticElementInteractions: resize handle
						<div
							key={edge}
							className={`absolute z-10 size-2 rounded-full border border-[var(--vetd-selected)] bg-white ${className}`}
							style={{ transform: `scale(${labelScale})` }}
							onPointerDown={(event) => beginDrag(event, edge)}
							onPointerMove={moveDrag}
							onPointerUp={endDrag}
						/>
					))
				: null}
		</div>
	);
});
