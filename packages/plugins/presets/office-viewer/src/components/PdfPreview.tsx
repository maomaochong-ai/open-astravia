import { type PluginFilePreviewProps, useTranslation } from "@astravia-org/plugin-sdk";
import * as pdfjsLib from "pdfjs-dist";
import workerSource from "pdfjs-dist/build/pdf.worker.min.mjs?raw";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { PreviewToolbar } from "./PreviewToolbar";
import { ErrorState, LoadingState, type LoadState } from "./PreviewState";
import { ToolbarButton } from "./ToolbarButton";

pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
	new Blob([workerSource], { type: "text/javascript" }),
);

const MIN_SCALE = 0.25;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;
// 滚动容器左右内边距合计，计算适应宽度时需扣除
const HORIZONTAL_PADDING = 40;

export function PdfPreview({ file }: PluginFilePreviewProps): JSX.Element {
	const { t } = useTranslation();
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const documentRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
	const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
	const renderTokenRef = useRef(0);
	const renderedScaleRef = useRef(0);
	const baseWidthRef = useRef(0);
	const autoFitRef = useRef(true);
	const [status, setStatus] = useState<LoadState>("loading");
	const [scale, setScale] = useState(1);

	// 以首页 scale=1 的宽度为基准，算出适应容器宽度的缩放（上限 100%）
	const computeFitScale = useCallback((): number => {
		const scroll = scrollRef.current;
		if (!scroll || baseWidthRef.current <= 0) return 1;
		const available = scroll.clientWidth - HORIZONTAL_PADDING;
		return Math.max(MIN_SCALE, Math.min(1, available / baseWidthRef.current));
	}, []);

	// 把整份 PDF 的所有页渲染成竖向堆叠的 canvas，实现连续滚动
	const renderAllPages = useCallback(
		async (nextScale: number) => {
			const pdf = documentRef.current;
			const container = containerRef.current;
			if (!pdf || !container) return;

			const token = ++renderTokenRef.current;
			renderTaskRef.current?.cancel();
			renderedScaleRef.current = nextScale;
			container.replaceChildren();
			const dpr = window.devicePixelRatio || 1;

			for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
				const pdfPage = await pdf.getPage(pageNumber);
				if (renderTokenRef.current !== token) return;

				const viewport = pdfPage.getViewport({ scale: nextScale });
				const canvas = document.createElement("canvas");
				canvas.width = Math.ceil(viewport.width * dpr);
				canvas.height = Math.ceil(viewport.height * dpr);
				canvas.style.width = `${viewport.width}px`;
				canvas.style.height = `${viewport.height}px`;
				canvas.className = "bg-white shadow-lg";
				canvas.setAttribute("aria-label", t("pdf.pageLabel", { name: file.name, page: pageNumber }));
				const context = canvas.getContext("2d");
				if (!context) throw new Error("Canvas unavailable");
				container.appendChild(canvas);

				const renderTask = pdfPage.render({
					canvasContext: context,
					viewport,
					transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
				});
				renderTaskRef.current = renderTask;
				await renderTask.promise;
				if (renderTokenRef.current !== token) return;
			}
		},
		[file.name, t],
	);

	useEffect(() => {
		let cancelled = false;
		setStatus("loading");
		setScale(1);
		renderedScaleRef.current = 0;
		autoFitRef.current = true;
		const task = pdfjsLib.getDocument({ url: file.getUrl() });
		void task.promise
			.then(async (pdf) => {
				if (cancelled) {
					await pdf.destroy();
					return;
				}
				documentRef.current = pdf;
				baseWidthRef.current = (await pdf.getPage(1)).getViewport({ scale: 1 }).width;
				if (cancelled) return;
				const fit = computeFitScale();
				setScale(fit);
				await renderAllPages(fit);
				if (!cancelled) setStatus("ready");
			})
			.catch((error: unknown) => {
				if (!cancelled && !(error instanceof pdfjsLib.RenderingCancelledException)) setStatus("error");
			});

		return () => {
			cancelled = true;
			renderTokenRef.current++;
			renderTaskRef.current?.cancel();
			renderTaskRef.current = null;
			documentRef.current = null;
			void task.destroy();
		};
	}, [file, renderAllPages, computeFitScale]);

	// 缩放变化时重渲染（跳过加载阶段已经渲染过的相同比例）
	useEffect(() => {
		if (status !== "ready" || scale === renderedScaleRef.current) return;
		void renderAllPages(scale).catch((error: unknown) => {
			if (!(error instanceof pdfjsLib.RenderingCancelledException)) setStatus("error");
		});
	}, [scale, status, renderAllPages]);

	// 容器尺寸变化时，仅在「适应宽度」模式下重新计算
	useEffect(() => {
		const scroll = scrollRef.current;
		if (!scroll || status !== "ready") return;
		const observer = new ResizeObserver(() => {
			if (autoFitRef.current) setScale(computeFitScale());
		});
		observer.observe(scroll);
		return () => observer.disconnect();
	}, [status, computeFitScale]);

	const adjustScale = useCallback((delta: number) => {
		autoFitRef.current = false;
		setScale((value) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.round((value + delta) * 100) / 100)));
	}, []);

	const fitToWidth = useCallback(() => {
		autoFitRef.current = true;
		setScale(computeFitScale());
	}, [computeFitScale]);

	return (
		<div className="relative flex h-full min-h-0 flex-1 flex-col bg-[var(--background)]">
			<div
				ref={scrollRef}
				className="relative flex min-h-0 flex-1 flex-col items-center gap-4 overflow-auto bg-[var(--muted)] px-5 pt-5 pb-16"
			>
				{status === "loading" && <LoadingState />}
				{status === "error" && <ErrorState message={t("pdf.error")} />}
				<div ref={containerRef} className={status === "ready" ? "flex flex-col items-center gap-4" : "hidden"} />
			</div>
			<PreviewToolbar>
				<ToolbarButton label="−" disabled={scale <= MIN_SCALE} onClick={() => adjustScale(-SCALE_STEP)} />
				<button
					type="button"
					className="min-w-14 text-center text-[12px] tabular-nums text-[var(--muted-foreground)]"
					onClick={fitToWidth}
				>
					{Math.round(scale * 100)}%
				</button>
				<ToolbarButton label="+" disabled={scale >= MAX_SCALE} onClick={() => adjustScale(SCALE_STEP)} />
				<div className="mx-1 h-4 w-px bg-[var(--border)]" />
				<ToolbarButton label={t("toolbar.fitWidth")} onClick={fitToWidth} />
			</PreviewToolbar>
		</div>
	);
}
