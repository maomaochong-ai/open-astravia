import { useTranslation } from "@vetta-org/plugin-sdk";
import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fitViewport, useViewport } from "../canvas/use-viewport";
import type { VetdFrameEntry, VetdManifest } from "../vetd/manifest-types";

/** fit 时四周留白（屏幕像素）。 */
const FIT_PADDING = 24;
/**
 * 同时允许「正在加载」的 iframe 数。
 *
 * 每个 frame 都是一份完整的 React 应用（分享包把整个引擎内联进了 srcdoc），六帧
 * 一起启动就是六次解析+首屏渲染挤在同一个渲染进程里。编辑态画布用的是位图+挂载
 * 窗口那一套（见 frame-raster.ts）；只读预览没有引擎、也没有截图链路，用不上那么
 * 重的机制，限制并发启动就够了。
 */
const LOAD_WINDOW = 2;
/** 可见区域外这么多屏之内的 frame 才建 iframe。 */
const CULL_MARGIN_SCREENS = 0.5;
/**
 * 裁剪矩形的重算触发线（屏）：可见区域逼近已裁剪范围边缘、余量不足这么多时才重算。
 * 同编辑态画布：onPaint 每帧都会调，每次都 setState 等于平移途中整棵预览每帧重渲染。
 */
const CULL_SLACK_SCREENS = 0.25;
/**
 * 同时留着的 iframe 上限。每个都是一份完整的 React 应用，进过可见范围就一直留着的话，
 * 来回平移浏览一圈，内存和合成层数就跟着 frame 总数一起涨。超出时先卸掉最久没出现在
 * 可见范围里的那个；回到它时重新加载一次，这是换内存的代价。
 */
const MAX_MOUNTED = 6;

const icons = {
	minus: (
		<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M5 12h14" strokeLinecap="round" />
		</svg>
	),
	plus: (
		<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M12 5v14M5 12h14" strokeLinecap="round" />
		</svg>
	),
	fit: (
		<svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M4 9V5a1 1 0 011-1h4M15 4h4a1 1 0 011 1v4M20 15v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	),
};

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

function boundsOfFrames(frames: readonly VetdFrameEntry[]): Rect | null {
	if (frames.length === 0) return null;
	const minX = Math.min(...frames.map((frame) => frame.x));
	const minY = Math.min(...frames.map((frame) => frame.y));
	const maxX = Math.max(...frames.map((frame) => frame.x + frame.width));
	const maxY = Math.max(...frames.map((frame) => frame.y + frame.height));
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

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

function intersects(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * 按视口给出新的裁剪矩形；现有的还够用时返回 null（调用方原地不动）。两种情况才重算：
 * - 余量不足 CULL_SLACK_SCREENS：接着平移/缩小就要露出没建 iframe 的区域了。
 * - 范围比需要的大一倍以上：放大之后旧矩形还按老比例留着，会一直多建一堆 iframe。
 */
export function nextCullRect(
	current: Rect | null,
	vp: { x: number; y: number; zoom: number },
	size: { width: number; height: number },
): Rect | null {
	const worldWidth = size.width / vp.zoom;
	const worldHeight = size.height / vp.zoom;
	const visible: Rect = { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, width: worldWidth, height: worldHeight };
	const next = inflate(visible, worldWidth * CULL_MARGIN_SCREENS, worldHeight * CULL_MARGIN_SCREENS);
	if (current) {
		const slack = inflate(current, -worldWidth * CULL_SLACK_SCREENS, -worldHeight * CULL_SLACK_SCREENS);
		const oversized = current.width > next.width * 2 || current.height > next.height * 2;
		if (contains(slack, visible) && !oversized) return null;
	}
	return next;
}

/**
 * 该建 iframe 的 frame：可见的（已按画布顺序排好）依次放行，还没加载完的同时最多
 * LOAD_WINDOW 个；已建的尽量保留，超过 MAX_MOUNTED 时先卸掉最久没出现在可见范围里的。
 * 返回 null 表示与 mounted 相同。
 */
export function planMounted(
	visibleIds: readonly string[],
	mounted: ReadonlySet<string>,
	loaded: ReadonlySet<string>,
	lastSeen: ReadonlyMap<string, number>,
): { mounted: Set<string>; evicted: string[] } | null {
	const visible = new Set(visibleIds);
	const next = new Set(mounted);
	let pending = [...next].filter((id) => !loaded.has(id)).length;
	for (const id of visibleIds) {
		if (next.has(id)) continue;
		if (pending >= LOAD_WINDOW) break;
		next.add(id);
		pending += 1;
	}
	const evictable = [...next]
		.filter((id) => !visible.has(id))
		.sort((a, b) => (lastSeen.get(a) ?? 0) - (lastSeen.get(b) ?? 0));
	const evicted: string[] = [];
	for (const id of evictable) {
		if (next.size <= MAX_MOUNTED) break;
		next.delete(id);
		evicted.push(id);
	}
	if (next.size === mounted.size && evicted.length === 0) return null;
	return { mounted: next, evicted };
}

/**
 * 分享包里的一帧：内联快照经 srcdoc 加载，再用 bridge 的 `show-frame` 切到这一帧。
 *
 * `pointer-events: none`：只读画布上任何位置的指针都属于平移，不能被 iframe 吃掉。
 * iframe 按 frame 的真实尺寸铺满画框，缩放由外层 world 的 transform 统一负责——
 * 所以放大之后仍是矢量渲染，不会糊。
 */
function SnapshotFrame({ html, frameId, onLoaded }: { html: string; frameId: string; onLoaded(): void }) {
	const ref = useRef<HTMLIFrameElement | null>(null);
	return (
		<iframe
			ref={ref}
			title={frameId}
			srcDoc={html}
			sandbox="allow-scripts"
			className="pointer-events-none h-full w-full border-0 bg-white"
			onLoad={() => {
				ref.current?.contentWindow?.postMessage({ vetd: true, type: "show-frame", id: frameId }, "*");
				onLoaded();
			}}
		/>
	);
}

interface PreviewCanvasProps {
	manifest: VetdManifest;
	/** 分享包里的内联快照；缺失时只画空画框（结构仍然看得到）。 */
	snapshotHtml: string | null;
}

/**
 * 分享包的只读画布：与设计面板同一套平移/缩放手感（见 use-viewport），但没有选中、
 * 拖拽、编辑与引擎连接——分享包是一份成品，预览只负责让人看清楚。
 */
export function PreviewCanvas({ manifest, snapshotHtml }: PreviewCanvasProps) {
	const { t } = useTranslation();
	const frames = manifest.frames;
	const contentBounds = useMemo(() => boundsOfFrames(frames), [frames]);
	/** 已经建了 iframe 的 frame（离开可见范围后还留着，来回平移不必反复重启动；总数见 MAX_MOUNTED）。 */
	const [mounted, setMounted] = useState<ReadonlySet<string>>(new Set());
	/** 已经加载完的 frame，用来放行下一批（并发闸门）。 */
	const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set());
	const [cullRect, setCullRect] = useState<Rect | null>(null);
	const cullRectRef = useRef<Rect | null>(null);
	/** 每个 frame 最近一次落在可见范围里的序号，淘汰 iframe 时先挑最小的。 */
	const lastSeenRef = useRef(new Map<string, number>());
	const seenTickRef = useRef(0);
	/** 首次量到容器尺寸时 fit 一次；之后由用户自己控制视口。 */
	const fittedRef = useRef(false);
	/** 容器尺寸已经量到——fit 要等它，首帧的 sizeRef 还是 0×0。 */
	const [measured, setMeasured] = useState(false);
	const measuredRef = useRef(false);

	/** 按当前视口更新裁剪矩形，够用就原地不动（见 nextCullRect）。 */
	const syncCullRect = useCallback((vp: { x: number; y: number; zoom: number }, size: { width: number; height: number }): void => {
		if (size.width === 0 || size.height === 0) return;
		if (!measuredRef.current) {
			measuredRef.current = true;
			setMeasured(true);
		}
		const next = nextCullRect(cullRectRef.current, vp, size);
		if (!next) return;
		cullRectRef.current = next;
		setCullRect(next);
	}, []);

	const view = useViewport({
		// 分享包自带的 canvas 视口是导出者的窗口尺寸，换一台机器就不对了；
		// 真正的初值来自下面首次量到容器尺寸时的 fit。
		initial: { x: 0, y: 0, zoom: 1 },
		onPaint: syncCullRect,
	});
	const { viewport, containerRef, worldRef, sizeRef, commitViewport } = view;

	const fitToContent = useCallback((): void => {
		const next = fitViewport(contentBounds, sizeRef.current, FIT_PADDING);
		if (next) commitViewport(next);
	}, [contentBounds, commitViewport, sizeRef]);

	// 首帧还没量到尺寸，fit 要等 ResizeObserver 报回来；之后 frames 变了也重 fit
	// （预览里 manifest 只会在换文件时整体替换）。
	useEffect(() => {
		fittedRef.current = false;
	}, [contentBounds]);
	useEffect(() => {
		if (fittedRef.current || !measured) return;
		fittedRef.current = true;
		fitToContent();
	}, [fitToContent, measured]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const onWheel = (event: WheelEvent): void => {
			event.preventDefault();
			view.applyWheel(event);
		};
		container.addEventListener("wheel", onWheel, { passive: false });
		return () => container.removeEventListener("wheel", onWheel);
	}, [containerRef, view.applyWheel]);

	/** 该建 iframe 的 frame，见 planMounted。 */
	useEffect(() => {
		if (!snapshotHtml) return;
		const visibleIds = frames
			.filter((frame) => !cullRect || intersects(cullRect, frame))
			.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
			.map((frame) => frame.id);
		const tick = ++seenTickRef.current;
		for (const id of visibleIds) lastSeenRef.current.set(id, tick);
		const plan = planMounted(visibleIds, mounted, loaded, lastSeenRef.current);
		if (!plan) return;
		setMounted(plan.mounted);
		// 卸掉的下次回来要重新加载，得重新占一个加载名额。
		if (plan.evicted.length > 0) {
			setLoaded((current) => {
				const kept = new Set(current);
				for (const id of plan.evicted) kept.delete(id);
				return kept;
			});
		}
	}, [frames, cullRect, loaded, mounted, snapshotHtml]);

	const markLoaded = useCallback((frameId: string): void => {
		setLoaded((current) => (current.has(frameId) ? current : new Set(current).add(frameId)));
	}, []);

	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (event.button !== 0) return;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		view.beginPan(event.pointerId, event.clientX, event.clientY);
	};

	const worldStyle = useMemo(
		() =>
			({
				transform: view.worldTransform,
				transformOrigin: "0 0",
				// 画框标题按它反向缩放，缩到多小都还读得出（与编辑态同一个变量）。
				"--vetd-lscale": Math.min(1 / viewport.zoom, 8),
			}) as CSSProperties,
		[view.worldTransform, viewport.zoom],
	);

	const renderedFrames = cullRect
		? frames.filter((frame) => intersects(cullRect, frame) || mounted.has(frame.id))
		: frames;

	return (
		<div
			ref={containerRef}
			className="relative h-full w-full cursor-grab select-none overflow-hidden vetd-canvas-bg active:cursor-grabbing"
			onPointerDown={onPointerDown}
			onPointerMove={(event) => view.panMove(event.pointerId, event.clientX, event.clientY)}
			onPointerUp={(event) => view.endPan(event.pointerId)}
		>
			<div ref={worldRef} className="absolute left-0 top-0" style={worldStyle}>
				{renderedFrames.map((frame) => (
					<div
						key={frame.id}
						className="absolute"
						style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
					>
						<div
							className="absolute bottom-full left-0 whitespace-nowrap pb-1 text-xs text-muted-foreground"
							style={{ transform: "scale(var(--vetd-lscale, 1))", transformOrigin: "0 100%" }}
						>
							{frame.title || frame.id}
						</div>
						{/* 直角：圆角会让 iframe 的 overflow 裁剪走带遮罩的合成路径（同编辑态 FrameView）。 */}
						<div className="h-full w-full overflow-hidden bg-white shadow ring-1 ring-border">
							{snapshotHtml && mounted.has(frame.id) ? (
								<SnapshotFrame
									html={snapshotHtml}
									frameId={frame.id}
									onLoaded={() => markLoaded(frame.id)}
								/>
							) : (
								<div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
									{frame.width}×{frame.height}
								</div>
							)}
						</div>
					</div>
				))}
			</div>
			<div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-popover/95 p-1 shadow-lg backdrop-blur">
				<button
					type="button"
					title={t("controlbar.zoomOut")}
					aria-label={t("controlbar.zoomOut")}
					onClick={() => view.zoomBy(-1)}
					className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					{icons.minus}
				</button>
				<button
					type="button"
					title={t("controlbar.zoomReset")}
					onClick={() => commitViewport({ ...view.viewportRef.current, zoom: 1 })}
					className="min-w-12 rounded-md px-1.5 py-1 text-xs tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					{Math.round(viewport.zoom * 100)}%
				</button>
				<button
					type="button"
					title={t("controlbar.zoomIn")}
					aria-label={t("controlbar.zoomIn")}
					onClick={() => view.zoomBy(1)}
					className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					{icons.plus}
				</button>
				<span className="mx-0.5 h-4 w-px bg-border" />
				<button
					type="button"
					title={t("preview.fit")}
					aria-label={t("preview.fit")}
					onClick={fitToContent}
					className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
				>
					{icons.fit}
				</button>
			</div>
		</div>
	);
}
