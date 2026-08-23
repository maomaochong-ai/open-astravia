import { useTranslation } from "@astravia-org/plugin-sdk";
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type MockupExportRequest, onMockupExport, requestMockupExport } from "../canvas/design-runtime";
import { byCanvasOrder } from "../canvas/frame-order";
import { loadRasters } from "../canvas/raster-cache";
import { parseThemeTokens } from "../canvas/theme-tokens";
import { fitViewport, useViewport } from "../canvas/use-viewport";
import { getPluginCtx, notify } from "../plugin-context";
import { attachFrame, detachFrame, railFrames, swapFrames } from "./attach";
import { bytesToBase64, dataUrlToBytes } from "./binary";
import { VETTA_LOGO_DATA_URL } from "./brand-logo";
import { FrameRail, type RailFrame } from "./FrameRail";
import { layoutMockup } from "./layout";
import { loadImage } from "./load-image";
import { type MockupDrag, MockupPage } from "./MockupPage";
import { MockupOptionsPanel } from "./MockupOptionsPanel";
import { defaultOptions, loadOptions, saveOptions } from "./options";
import { paginate } from "./paginate";
import { buildImagePdf, type PdfPageImage } from "./pdf";
import { canvasToJpegDataUrl, renderMockupToCanvas, stitchPagesVertically } from "./render";
import { FRAMES_PER_PAGE, type MockupOptions, type MockupShot } from "./types";
import { centerViewport, stackPages } from "./workbench-view";

type ExportFormat = "image" | "pdf";

/** Capture ratio used for the on-screen preview; export re-captures per shot. */
const PREVIEW_PIXEL_RATIO = 2;
const MAX_PIXEL_RATIO = 4;
/** 页与页之间的留白，按整叠图的宽度取——页本身已经自带内边距。 */
const PAGE_GAP_RATIO = 0.04;
/** 自动 fit 时四周的留白（屏幕像素）。 */
const FIT_PADDING = 24;
/**
 * 缩放停下多久后按最终倍率重新光栅化。手势进行中位图只被 CSS 拉伸——
 * 每个 pinch tick 都重画整页位图正是预览卡顿的原因。
 */
const RASTER_SETTLE_MS = 160;

interface CaptureState {
	image: HTMLImageElement | null;
	error: string | null;
}

interface ShotEntry extends MockupShot {
	error: string | null;
}

/**
 * 渲染图工作台，挂在宿主的全局插槽里，好盖住整个窗口——设计画布在活动面板里，
 * 那点宽度根本判断不了圆角和边框。
 *
 * 由插件宿主常驻渲染；画布通过 design-runtime 发出请求前，它什么都不画。
 */
export function ExportMockupDialog() {
	const { t } = useTranslation();
	const [request, setRequest] = useState<MockupExportRequest | null>(null);
	/** 已加入渲染区的画框 id，顺序即导出顺序。 */
	const [attached, setAttached] = useState<string[]>([]);
	const [captures, setCaptures] = useState<ReadonlyMap<string, CaptureState>>(new Map());
	const [thumbnails, setThumbnails] = useState<ReadonlyMap<string, string>>(new Map());
	const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
	const [options, setOptions] = useState<MockupOptions | null>(null);
	const [format, setFormat] = useState<ExportFormat>("image");
	const [busy, setBusy] = useState<"save" | "copy" | null>(null);
	const [palette, setPalette] = useState<string[]>([]);
	const [logo, setLogo] = useState<HTMLImageElement | null>(null);
	const [drag, setDrag] = useState<MockupDrag | null>(null);
	/** 视图落定后的光栅化倍率；手势中的实时缩放由 world 层的 transform 承担。 */
	const [rasterScale, setRasterScale] = useState(1);
	const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
	const requestRef = useRef<MockupExportRequest | null>(null);
	requestRef.current = request;
	/**
	 * 预览台的 DOM 节点用 state 而不是 ref 持有：工作台在收到请求之前整个返回 null，
	 * 挂 ref 的 effect 只跑一次就再也不会重跑，节点是后来才出现的——测不到尺寸，
	 * 视口就一直是 0，自动 fit 永远不触发，内容以 100% 钉在原点。回调 ref 会在节点
	 * 真正挂上时通知一次，这个时机才是对的。
	 */
	const [stage, setStage] = useState<HTMLDivElement | null>(null);
	/** 正在截图的 frame，避免同一帧被重复排队。 */
	const inFlightRef = useRef(new Set<string>());
	/** 这次会话是否已经自动 fit 过一次：之后只听用户的缩放。 */
	const fittedRef = useRef(false);
	/**
	 * 与设计画布同一套视口手感：滚轮平移、Ctrl/⌘+滚轮绕光标缩放，平移途中
	 * 只改 world 层的 transform、落定才回 state——预览要与画布一样丝滑。
	 */
	const view = useViewport({ initial: { x: 0, y: 0, zoom: 1 } });
	const stageRef = useCallback(
		(node: HTMLDivElement | null) => {
			view.containerRef.current = node;
			setStage(node);
		},
		[view.containerRef],
	);

	useEffect(() => onMockupExport(setRequest), []);

	useEffect(() => {
		let cancelled = false;
		void loadImage(VETTA_LOGO_DATA_URL).then((image) => {
			if (!cancelled) setLogo(image);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const close = useCallback(() => requestMockupExport(null), []);

	/** 截一帧并填进对应的格子，布局不因此重排。 */
	const captureInto = useCallback(async (frameId: string): Promise<void> => {
		const active = requestRef.current;
		if (!active || inFlightRef.current.has(frameId)) return;
		inFlightRef.current.add(frameId);
		setCaptures((current) => new Map(current).set(frameId, { image: null, error: null }));
		try {
			const dataUrl = await active.capture(frameId, PREVIEW_PIXEL_RATIO);
			const image = await loadImage(dataUrl);
			if (requestRef.current !== active) return;
			setCaptures((current) => new Map(current).set(frameId, { image, error: null }));
		} catch (error) {
			if (requestRef.current !== active) return;
			const message = error instanceof Error ? error.message : String(error);
			setCaptures((current) => new Map(current).set(frameId, { image: null, error: message }));
		} finally {
			inFlightRef.current.delete(frameId);
		}
	}, []);

	/** 设计稿里的全部画框，按画布顺序——左侧列表和渲染顺序都以它为准。 */
	const frames = useMemo(
		() => (request ? [...request.session.manifest.frames].sort(byCanvasOrder) : []),
		[request],
	);

	// 新请求：接住初始选中集，读主题色与缩略图，选项按这份设计稿的历史设置还原。
	useEffect(() => {
		inFlightRef.current.clear();
		fittedRef.current = false;
		setCaptures(new Map());
		setThumbnails(new Map());
		setSelectedFrameId(null);
		setDrag(null);
		if (!request) {
			setAttached([]);
			setOptions(null);
			return;
		}
		const known = new Set(request.session.manifest.frames.map((frame) => frame.id));
		setAttached(request.initialFrameIds.filter((frameId) => known.has(frameId)));
		const normalizedHeight = Math.max(1, ...request.session.manifest.frames.map((frame) => frame.height));
		setOptions(loadOptions(request.session.astdPath, normalizedHeight));
		void request.session
			.readThemeCss()
			.then((css) => setPalette(parseThemeTokens(css).map((token) => token.value)))
			.catch(() => setPalette([]));
		// 缩略图直接用画布留下的缓存位图：为了一列小图再把每帧拉活体截一遍不值当。
		void loadRasters(
			request.session.astdPath,
			request.session.manifest.frames.map((frame) => frame.id),
		)
			.then(setThumbnails)
			.catch(() => setThumbnails(new Map()));
	}, [request]);

	// 加入渲染区就去截图；已经有结果或正在截的跳过（移除再加回来不重截）。
	useEffect(() => {
		if (!request) return;
		for (const frameId of attached) {
			if (!captures.has(frameId)) void captureInto(frameId);
		}
	}, [request, attached, captures, captureInto]);

	useEffect(() => {
		if (!request || !options) return;
		saveOptions(request.session.astdPath, options);
	}, [request, options]);

	useEffect(() => {
		if (!request) return;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			close();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [request, close]);

	useLayoutEffect(() => {
		if (!stage) return;
		const rect = stage.getBoundingClientRect();
		setStageSize({ width: rect.width, height: rect.height });
		const observer = new ResizeObserver(([entry]) => {
			setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
		});
		observer.observe(stage);
		return () => observer.disconnect();
	}, [stage]);

	// 原生 wheel 且 passive:false：pinch 缩放必须 preventDefault，否则浏览器的
	// 页面缩放会跟手势抢，这正是「不顺滑」的另一半来源。悬浮面板要自己滚动，
	// 落在它们上面的滚轮不归预览台。
	useEffect(() => {
		if (!stage) return;
		const onWheel = (event: WheelEvent): void => {
			if (event.target instanceof Element && event.target.closest("[data-mockup-overlay]")) return;
			event.preventDefault();
			view.applyWheel(event);
		};
		stage.addEventListener("wheel", onWheel, { passive: false });
		return () => stage.removeEventListener("wheel", onWheel);
	}, [stage, view.applyWheel]);

	// 缩放落定后按最终倍率重新光栅化位图；手势中位图只被 CSS 拉伸。
	const settledZoom = view.viewport.zoom;
	useEffect(() => {
		const id = window.setTimeout(() => setRasterScale(settledZoom), RASTER_SETTLE_MS);
		return () => window.clearTimeout(id);
	}, [settledZoom]);

	const shots = useMemo<ShotEntry[]>(() => {
		const byId = new Map(frames.map((frame) => [frame.id, frame]));
		return attached.flatMap((frameId) => {
			const frame = byId.get(frameId);
			if (!frame) return [];
			const capture = captures.get(frameId);
			return [
				{
					frameId,
					title: frame.title || frame.id,
					cssWidth: frame.width,
					cssHeight: frame.height,
					image: capture?.image ?? null,
					error: capture?.error ?? null,
				},
			];
		});
	}, [attached, frames, captures]);

	const pages = useMemo(() => paginate(shots, options?.perPage ?? 3), [shots, options?.perPage]);
	/**
	 * 每页留几格。只有一页时按实际画框数收紧——一张图右边空出两格纯属浪费；
	 * 一旦换页就固定成 perPage，末页不满也占满宽度，多页叠起来才对得齐。
	 */
	const slotsPerPage = pages.length > 1 ? (options?.perPage ?? shots.length) : shots.length;

	/** 每页的 layout 尺寸 + 竖向堆叠位置，全在世界坐标里。 */
	const stack = useMemo(() => {
		if (!options) return { world: { width: 0, height: 0 }, boxes: [] };
		const sizes = pages.map((pageShots) => layoutMockup(pageShots, options, slotsPerPage));
		const width = sizes.length > 0 ? Math.max(...sizes.map((size) => size.width)) : 0;
		return stackPages(sizes, width * PAGE_GAP_RATIO);
	}, [pages, options, slotsPerPage]);

	// 内容第一次有东西可看时铺满窗口；之后的缩放只由用户决定。
	useLayoutEffect(() => {
		if (fittedRef.current) return;
		const fitted = fitViewport({ x: 0, y: 0, ...stack.world }, stageSize, FIT_PADDING);
		if (!fitted) return;
		fittedRef.current = true;
		view.commitViewport(fitted);
	}, [stack.world, stageSize, view.commitViewport]);

	const errors = useMemo(() => {
		const map = new Map<string, string>();
		for (const shot of shots) if (shot.error) map.set(shot.frameId, shot.error);
		return map;
	}, [shots]);
	const pending = shots.some((shot) => !shot.image && !shot.error);
	const ready = shots.length > 0 && !pending && errors.size === 0;

	const rail = useMemo<RailFrame[]>(
		() =>
			railFrames(frames, attached).map((frame) => ({
				id: frame.id,
				title: frame.title || frame.id,
				width: frame.width,
				height: frame.height,
				thumbnail: thumbnails.get(frame.id) ?? null,
			})),
		[frames, attached, thumbnails],
	);

	const normalizedHeight = frames.length > 0 ? Math.max(...frames.map((frame) => frame.height)) : 0;
	const selectedShot = shots.find((shot) => shot.frameId === selectedFrameId) ?? null;

	const attach = useCallback((frameId: string, atIndex?: number): void => {
		setAttached((current) => attachFrame(current, frameId, atIndex));
		setSelectedFrameId(frameId);
	}, []);

	const detach = useCallback((frameId: string): void => {
		setAttached((current) => detachFrame(current, frameId));
		setSelectedFrameId((current) => (current === frameId ? null : current));
	}, []);

	/** 落点语义：从左侧列表来的插到那一格前面，渲染区内部互拖则是互换。 */
	const dropAt = (index: number): void => {
		if (!drag) return;
		if (drag.kind === "rail") attach(drag.frameId, index);
		else setAttached((current) => swapFrames(current, drag.index, index));
		setDrag(null);
	};

	const dropAtEnd = (): void => {
		if (drag?.kind === "rail") attach(drag.frameId);
		setDrag(null);
	};

	/**
	 * 按最终图真正需要的倍率重截这一页，文字才是锐的，而不是把 2 倍的预览位图放大。
	 */
	const composePage = async (pageShots: ShotEntry[], current: MockupOptions): Promise<HTMLCanvasElement> => {
		const active = requestRef.current;
		if (!active) throw new Error("export request went away");
		const layout = layoutMockup(pageShots, current, slotsPerPage);
		const pageHeight = Math.max(...pageShots.map((shot) => shot.cssHeight));
		const fresh: MockupShot[] = [];
		for (const shot of pageShots) {
			const needed = (pageHeight / shot.cssHeight) * current.scale * layout.fit;
			const ratio = Math.min(MAX_PIXEL_RATIO, Math.max(1, needed));
			const dataUrl = await active.capture(shot.frameId, ratio);
			fresh.push({ ...shot, image: await loadImage(dataUrl) });
		}
		return renderMockupToCanvas(fresh, current, logo, slotsPerPage);
	};

	/** 逐页合成。Astravia 标识只出现在第一页，多页时不该每页重复一次。 */
	const composeAllPages = async (current: MockupOptions): Promise<HTMLCanvasElement[]> => {
		const rendered: HTMLCanvasElement[] = [];
		for (const [index, pageShots] of pages.entries()) {
			rendered.push(await composePage(pageShots, index === 0 ? current : { ...current, brand: false }));
		}
		return rendered;
	};

	const baseName = (): string => `${requestRef.current?.session.name ?? "design"}-mockup`;

	/** 单页就是一张 PNG，多页竖着拼成一张长图。 */
	const composeImage = async (current: MockupOptions): Promise<HTMLCanvasElement> =>
		stitchPagesVertically(await composeAllPages(current), current);

	const savePng = async (current: MockupOptions): Promise<string | null> => {
		const dataUrl = (await composeImage(current)).toDataURL("image/png");
		return getPluginCtx().fs.saveAs(`${baseName()}.png`, dataUrl.split(",")[1] ?? "", "base64", {
			title: t("mockup.save.title"),
			filters: [{ name: "PNG", extensions: ["png"] }],
		});
	};

	/** Uniform page width (the widest page); the badge rides the cover only. */
	const savePdf = async (current: MockupOptions): Promise<string | null> => {
		const rendered: PdfPageImage[] = (await composeAllPages(current)).map((canvas) => ({
			jpeg: dataUrlToBytes(canvasToJpegDataUrl(canvas)),
			width: canvas.width,
			height: canvas.height,
		}));
		const pageWidth = Math.max(...rendered.map((page) => page.width)) / current.scale;
		const pdf = buildImagePdf(rendered, pageWidth);
		return getPluginCtx().fs.saveAs(`${baseName()}.pdf`, bytesToBase64(pdf), "base64", {
			title: t("mockup.save.title"),
			filters: [{ name: "PDF", extensions: ["pdf"] }],
		});
	};

	const runSave = async (): Promise<void> => {
		if (!options || busy || !ready) return;
		setBusy("save");
		try {
			const saved = format === "pdf" ? await savePdf(options) : await savePng(options);
			if (saved) notify({ message: t("mockup.save.done", { path: saved }), variant: "success", durationMs: 5000 });
		} catch (error) {
			notify({ message: t("mockup.save.failed"), error });
		} finally {
			setBusy(null);
		}
	};

	const runCopy = async (): Promise<void> => {
		if (!options || busy || !ready) return;
		setBusy("copy");
		try {
			const canvas = await composeImage(options);
			await getPluginCtx().ui.copyImage(canvas.toDataURL("image/png"));
			notify({ message: t("mockup.copy.done"), variant: "success", durationMs: 3000 });
		} catch (error) {
			notify({ message: t("mockup.copy.failed"), error });
		} finally {
			setBusy(null);
		}
	};

	if (!request || !options) return null;

	const multiPage = pages.length > 1;

	return (
		// 顶部留出宿主标题栏（TitleBar 是 h-9）的高度：macOS 红绿灯就在那条带里，
		// 模态和它的遮罩都不能盖住，否则点窗口按钮会变成关弹窗。
		<div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/55 px-6 pb-6 pt-11">
			{/* biome-ignore lint/a11y/noStaticElementInteractions: click-outside backdrop */}
			<div className="absolute inset-x-0 bottom-0 top-9" onClick={close} />
			<div className="relative flex h-[85vh] w-[85vw] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
				<div className="flex items-center gap-2 border-b border-border px-4 py-3">
					<span className="text-sm font-medium text-foreground">{t("mockup.title")}</span>
					<span className="text-xs text-muted-foreground">
						{t("mockup.subtitle", { count: shots.length, perPage: options.perPage })}
					</span>
					<div className="flex-1" />
					<button
						type="button"
						onClick={close}
						aria-label={t("mockup.close")}
						className="rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-accent"
					>
						✕
					</button>
				</div>

				<div className="flex min-h-0 flex-1">
					<FrameRail
						frames={rail}
						total={frames.length}
						onAttach={(frameId) => attach(frameId)}
						onAttachAll={() => {
							setAttached((current) => rail.reduce((list, frame) => attachFrame(list, frame.id), current));
						}}
						onDragStart={(frameId) => setDrag({ kind: "rail", frameId })}
						onDragEnd={() => setDrag(null)}
					/>

					{/* 预览台：整块都是图片，可自由缩放平移。 */}
					{/* biome-ignore lint/a11y/noStaticElementInteractions: 平移/缩放手势面，语义由下方缩放按钮承担 */}
					<div
						ref={stageRef}
						className="relative min-h-0 min-w-0 flex-1 cursor-grab overflow-hidden bg-muted/30 active:cursor-grabbing"
						onPointerDown={(event) => {
							if (event.button !== 0 && event.button !== 1) return;
							view.beginPan(event.pointerId, event.clientX, event.clientY);
							event.currentTarget.setPointerCapture(event.pointerId);
							setSelectedFrameId(null);
						}}
						onPointerMove={(event) => {
							view.panMove(event.pointerId, event.clientX, event.clientY);
						}}
						onPointerUp={(event) => {
							if (view.endPan(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
						}}
						onPointerCancel={(event) => {
							view.endPan(event.pointerId);
						}}
						onDragOver={(event) => {
							if (drag) event.preventDefault();
						}}
						onDrop={(event) => {
							event.preventDefault();
							dropAtEnd();
						}}
					>
						<div
							ref={view.worldRef}
							className="absolute left-0 top-0"
							style={
								{
									transform: view.worldTransform,
									transformOrigin: "0 0",
									// 选中框、报错卡片、页码标签按它反向缩放，保持恒定视觉大小。
									"--astd-lscale": Math.min(1 / view.viewport.zoom, 8),
								} as CSSProperties
							}
						>
							{pages.map((pageShots, index) => {
								const box = stack.boxes[index];
								if (!box) return null;
								return (
									<div
										key={pageShots[0]?.frameId ?? index}
										className="absolute"
										style={{ left: box.left, top: box.top }}
									>
										{multiPage ? (
											<span
												className="pointer-events-none absolute left-0 top-0 pb-1.5 text-[11px] tabular-nums text-muted-foreground"
												style={{ transform: "translateY(-100%) scale(var(--astd-lscale, 1))", transformOrigin: "0 100%" }}
											>
												{t("mockup.page.index", { index: index + 1, total: pages.length })}
											</span>
										) : null}
										<MockupPage
											shots={pageShots}
											offset={index * options.perPage}
											slots={slotsPerPage}
											options={options}
											brandLogo={logo}
											errors={errors}
											rasterScale={rasterScale}
											selectedFrameId={selectedFrameId}
											drag={drag}
											onSelect={setSelectedFrameId}
											onRetry={(frameId) => {
												setCaptures((current) => {
													const next = new Map(current);
													next.delete(frameId);
													return next;
												});
											}}
											onDragShot={(shotIndex) => setDrag({ kind: "shot", index: shotIndex })}
											onDragEnd={() => setDrag(null)}
											onDropAt={dropAt}
										/>
									</div>
								);
							})}
						</div>

						{shots.length === 0 ? (
							<div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
								<span className="text-sm font-medium text-foreground">{t("mockup.empty.title")}</span>
								<p className="max-w-64 text-xs text-muted-foreground">{t("mockup.empty.desc")}</p>
							</div>
						) : null}

						{/* 悬浮选项卡片：右上角，不占预览宽度。 */}
						<div data-mockup-overlay className="pointer-events-none absolute bottom-3 right-3 top-3 flex justify-end">
							<MockupOptionsPanel
								options={options}
								maxRadius={normalizedHeight / 2}
								palette={palette}
								selected={
									selectedShot ? { frameId: selectedShot.frameId, title: selectedShot.title } : null
								}
								onChange={(patch) => setOptions((current) => (current ? { ...current, ...patch } : current))}
								onRemoveSelected={() => selectedShot && detach(selectedShot.frameId)}
								onReset={() => setOptions(defaultOptions(normalizedHeight))}
							/>
						</div>

						{/* 每张图的画框数：底部居中悬浮——它决定的是「图怎么分页」，
						    比右侧那些外观参数更靠近画面本身。 */}
						<div
							data-mockup-overlay
							className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-popover/95 px-2 py-1 shadow-md backdrop-blur-md"
							onPointerDown={(event) => event.stopPropagation()}
						>
							<span className="pr-1 text-[11px] text-muted-foreground">{t("mockup.option.perPage")}</span>
							{FRAMES_PER_PAGE.map((value) => (
								<button
									key={value}
									type="button"
									onClick={() => setOptions((current) => (current ? { ...current, perPage: value } : current))}
									className={`min-w-7 rounded-md px-2 py-1 text-xs font-medium tabular-nums transition-colors ${
										options.perPage === value
											? "bg-primary text-primary-foreground"
											: "text-muted-foreground hover:bg-accent"
									}`}
								>
									{value}
								</button>
							))}
						</div>

						{/* 缩放控件：左下角，与预览台同层。 */}
						<div
							data-mockup-overlay
							className="absolute bottom-3 left-3 flex items-center gap-0.5 rounded-lg border border-border bg-popover/95 p-0.5 shadow-md backdrop-blur-md"
							onPointerDown={(event) => event.stopPropagation()}
						>
							<button
								type="button"
								aria-label={t("mockup.view.zoomOut")}
								onClick={() => view.zoomBy(-1)}
								className="rounded-md px-2 py-1 text-xs text-foreground hover:bg-accent"
							>
								−
							</button>
							<span className="min-w-11 text-center text-[11px] tabular-nums text-muted-foreground">
								{Math.round(view.viewport.zoom * 100)}%
							</span>
							<button
								type="button"
								aria-label={t("mockup.view.zoomIn")}
								onClick={() => view.zoomBy(1)}
								className="rounded-md px-2 py-1 text-xs text-foreground hover:bg-accent"
							>
								+
							</button>
							<button
								type="button"
								onClick={() =>
									view.commitViewport(
										fitViewport({ x: 0, y: 0, ...stack.world }, stageSize, FIT_PADDING) ?? { x: 0, y: 0, zoom: 1 },
									)
								}
								className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
							>
								{t("mockup.view.fit")}
							</button>
							<button
								type="button"
								onClick={() => view.commitViewport(centerViewport(stack.world, stageSize, 1))}
								className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
							>
								{t("mockup.view.actual")}
							</button>
						</div>
					</div>
				</div>

				<div className="flex items-center gap-2 border-t border-border px-4 py-3">
					<span className="text-xs text-muted-foreground">
						{pending
							? t("mockup.status.capturing")
							: errors.size > 0
								? t("mockup.status.failed", { count: errors.size })
								: t("mockup.status.pages", { count: pages.length })}
					</span>
					<div className="flex-1" />
					<div className="flex items-center gap-0.5 rounded-lg border border-border p-0.5">
						<button
							type="button"
							onClick={() => setFormat("image")}
							className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
								format === "image"
									? "bg-primary text-primary-foreground"
									: "text-muted-foreground hover:bg-accent"
							}`}
						>
							{multiPage ? t("mockup.format.longImage") : t("mockup.format.png")}
						</button>
						<button
							type="button"
							onClick={() => setFormat("pdf")}
							className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
								format === "pdf"
									? "bg-primary text-primary-foreground"
									: "text-muted-foreground hover:bg-accent"
							}`}
						>
							{t("mockup.format.pdf")}
						</button>
					</div>
					<button
						type="button"
						disabled={!ready || busy !== null}
						onClick={() => void runCopy()}
						className="rounded-lg px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-40"
					>
						{busy === "copy" ? t("mockup.copy.running") : t("mockup.copy")}
					</button>
					<button
						type="button"
						disabled={!ready || busy !== null}
						onClick={() => void runSave()}
						className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
					>
						{busy === "save" ? t("mockup.save.running") : t("mockup.save")}
					</button>
				</div>
			</div>
		</div>
	);
}
