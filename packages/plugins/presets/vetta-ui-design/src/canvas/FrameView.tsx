import { useTranslation } from "@vetta-org/plugin-sdk";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import type { VetdFrameEntry } from "../vetd/manifest-types";
import type { BridgeHub } from "./bridge-client";
import type { FrameActivity } from "./design-runtime";
import { FrameTitleInput } from "./FrameTitleInput";

type ResizeEdge = "nw" | "ne" | "sw" | "se" | "e" | "s";

interface FrameViewProps {
	frame: VetdFrameEntry;
	port: number;
	zoom: number;
	bridge: BridgeHub;
	selected: boolean;
	/** Inspect mode: pointer events pass through to the iframe. */
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
	activity: FrameActivity | undefined;
	/** 非 null 时这一帧编译/渲染失败：盖住上一张位图，标题栏挂徽标（详情走 title）。 */
	buildError: string | null;
	/** true 时标题变成就地编辑的输入框（双击标题，或右键菜单里的重命名）。 */
	renaming: boolean;
	onSelect(additive: boolean): void;
	onEnter(): void;
	/** 右键：坐标是视口坐标（clientX/Y），由画布换算成容器内坐标定位菜单。 */
	onContextMenu(clientX: number, clientY: number): void;
	onRenameStart(): void;
	/** 提交由画布落盘；标题没变或为空时画布自行忽略。 */
	onRenameCommit(title: string): void;
	onRenameCancel(): void;
	/** Moves are owned by the canvas so every selected frame travels together. */
	onMoveStart(additive: boolean): void;
	onMoveDelta(dx: number, dy: number): void;
	onMoveEnd(): void;
	onResizeCommit(patch: Partial<Pick<VetdFrameEntry, "x" | "y" | "width" | "height">>): void;
}

interface DragState {
	pointerId: number;
	startX: number;
	startY: number;
	origin: { x: number; y: number; width: number; height: number };
	edge: ResizeEdge | "move";
}

const MIN_WIDTH = 100;
const MIN_HEIGHT = 80;
/**
 * 收不到「画好了」信号时的兜底：iframe 加载完这么久之后照样交接。引擎渲染不出内容
 * （bridge 没装上、frame 抛错在边界里）时不能让位图永远盖着。
 */
const PAINT_FALLBACK_MS = 2_500;
/** 位图淡出时长，需与下面 img 上的 duration 一致——过渡结束才把它从 DOM 摘掉。 */
const RASTER_FADE_MS = 200;

export function FrameView({
	frame,
	port,
	zoom,
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
	activity,
	buildError,
	renaming,
	onSelect,
	onEnter,
	onContextMenu,
	onRenameStart,
	onRenameCommit,
	onRenameCancel,
	onMoveStart,
	onMoveDelta,
	onMoveEnd,
	onResizeCommit,
}: FrameViewProps) {
	const { t } = useTranslation();
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const dragRef = useRef<DragState | null>(null);
	/** 改尺寸拖拽期间的实时矩形（提交前不落 manifest）。 */
	const [resizeRect, setResizeRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
	/** 当前这个 iframe 是否已经把内容画出来了——位图要盖到这一刻才撤。 */
	const [loaded, setLoaded] = useState(false);
	/** 位图淡出还没结束时它仍留在 DOM 里，交接才有得可看。 */
	const [rasterMounted, setRasterMounted] = useState(true);
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

	const shouldShowRaster = !live || !loaded || buildError !== null;

	// 需要位图时先确保它在 DOM 里；不需要了也要等淡出跑完再摘。
	// 这里用定时器而不是 onTransitionEnd：标签页在后台等情况下过渡事件可能根本不来，
	// 那样位图会永远挡着活体。
	useEffect(() => {
		if (shouldShowRaster) {
			setRasterMounted(true);
			return;
		}
		const timer = window.setTimeout(() => setRasterMounted(false), RASTER_FADE_MS);
		return () => window.clearTimeout(timer);
	}, [shouldShowRaster]);

	// mounted 必须在依赖里：iframe 是按挂载节流条件渲染的，false→true 时这个
	// effect 要重跑才能把真正的 iframe 注册进 bridge。漏了它的话，后挂上的 frame
	// 发出的 rendered / captured 消息认不出 frameId，截图队列会永远卡在原地。
	useEffect(() => {
		bridge.register(frame.id, iframeRef.current);
		return () => bridge.register(frame.id, null);
	}, [bridge, frame.id, mounted]);

	const rect = resizeRect ?? {
		x: frame.x + (moveDelta?.dx ?? 0),
		y: frame.y + (moveDelta?.dy ?? 0),
		width: frame.width,
		height: frame.height,
	};

	const beginDrag = (event: ReactPointerEvent, edge: DragState["edge"]): void => {
		// 只认左键：右键要留给上下文菜单，捕获指针会把后续事件都劫走。
		if (event.button !== 0) return;
		if (!interactive || entered) return;
		event.preventDefault();
		event.stopPropagation();
		if (edge === "move") onMoveStart(event.shiftKey);
		else onSelect(false);
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		dragRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			origin: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
			edge,
		};
	};

	const moveDrag = (event: ReactPointerEvent): void => {
		const drag = dragRef.current;
		if (!drag || event.pointerId !== drag.pointerId) return;
		const dx = (event.clientX - drag.startX) / zoom;
		const dy = (event.clientY - drag.startY) / zoom;
		const { origin } = drag;
		if (drag.edge === "move") {
			onMoveDelta(Math.round(dx), Math.round(dy));
			return;
		}
		let { x, y, width, height } = origin;
		if (drag.edge.includes("e")) width = origin.width + dx;
		if (drag.edge.includes("s")) height = origin.height + dy;
		if (drag.edge.includes("w")) {
			width = origin.width - dx;
			x = origin.x + dx;
		}
		if (drag.edge === "nw" || drag.edge === "ne") {
			height = origin.height - dy;
			y = origin.y + dy;
		}
		if (width < MIN_WIDTH) {
			if (drag.edge.includes("w")) x -= MIN_WIDTH - width;
			width = MIN_WIDTH;
		}
		if (height < MIN_HEIGHT) {
			if (drag.edge === "nw" || drag.edge === "ne") y -= MIN_HEIGHT - height;
			height = MIN_HEIGHT;
		}
		setResizeRect({
			x: Math.round(x),
			y: Math.round(y),
			width: Math.round(width),
			height: Math.round(height),
		});
	};

	const endDrag = (event: ReactPointerEvent): void => {
		const drag = dragRef.current;
		if (!drag || event.pointerId !== drag.pointerId) return;
		dragRef.current = null;
		if (drag.edge === "move") {
			onMoveEnd();
			return;
		}
		if (resizeRect) {
			onResizeCommit(resizeRect);
			setResizeRect(null);
		}
	};

	const labelScale = Math.min(1 / zoom, 8);
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
				onContextMenu(event.clientX, event.clientY);
			}}
		>
			{/* Title bar (inverse-scaled so it stays readable at any zoom). */}
			<div
				className="absolute left-0 flex items-center gap-1.5 whitespace-nowrap text-xs"
				style={{
					transform: `scale(${labelScale})`,
					transformOrigin: "left bottom",
					bottom: "100%",
					marginBottom: 4 * labelScale,
				}}
			>
				{renaming ? (
					<FrameTitleInput
						initial={frame.title || frame.id}
						onCommit={onRenameCommit}
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
							if (interactive) onRenameStart();
						}}
						title={frame.title || frame.id}
					>
						{frame.title || frame.id}
					</button>
				)}
				<span className="text-muted-foreground">
					{rect.width}×{rect.height}
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
						// nonce 放在查询串而不是 hash：改 hash 只会触发 hashchange，文档不会重新加载。
						src={`http://127.0.0.1:${port}/?r=${reloadNonce}#/frame/${encodeURIComponent(frame.id)}`}
						className="h-full w-full border-0"
						style={{ pointerEvents: entered ? "auto" : "none", display: live ? "block" : "none" }}
						// 文档 load 只用来起兜底计时：真正的交接信号是 paintTick。
						onLoad={() => {
							if (fallbackRef.current !== null) window.clearTimeout(fallbackRef.current);
							fallbackRef.current = window.setTimeout(() => setLoaded(true), PAINT_FALLBACK_MS);
						}}
					/>
				) : null}
				{/* 位图盖在 iframe 上，等它真的把内容画出来再淡出：刚挂载的 iframe 有一段
				    空白期，直接切过去就是肉眼可见的白闪。注意这里必须让 img 留在 DOM 里跑完
				    过渡（rasterMounted），按「该不该显示」直接卸载的话 opacity 过渡根本没有
				    机会执行，交接就还是硬切。
				    构建失败时也留着：iframe 里此刻只有兜底文案，上一张好图才是用户要看的。 */}
				{raster && rasterMounted ? (
					<img
						src={raster}
						alt=""
						aria-hidden
						className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
							shouldShowRaster ? "opacity-100" : "opacity-0"
						}`}
					/>
				) : null}
				{!raster && !loaded && !buildError ? (
					<div className="absolute inset-0 flex items-center justify-center bg-muted">
						<span className="size-4 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-transparent" />
					</div>
				) : null}
				{/* Interaction shield: select/move at frame level until the user drills in. */}
				{!entered ? (
					// biome-ignore lint/a11y/noStaticElementInteractions: canvas manipulation surface
					<div
						className="absolute inset-0"
						style={{ cursor: interactive ? "default" : "inherit" }}
						onPointerDown={(event) => beginDrag(event, "move")}
						onPointerMove={moveDrag}
						onPointerUp={endDrag}
						onDoubleClick={(event) => {
							event.stopPropagation();
							if (interactive) onEnter();
						}}
					/>
				) : null}
			</div>

			{selected && resizable && !entered
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
}
