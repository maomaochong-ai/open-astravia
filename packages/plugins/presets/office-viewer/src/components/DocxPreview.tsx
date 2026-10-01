import { type PluginFilePreviewProps, useTranslation } from "@astravia-org/plugin-sdk";
import { renderAsync } from "docx-preview";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { fetchFileBytes } from "../utils/file";
import { PreviewToolbar } from "./PreviewToolbar";
import { ErrorState, LoadingState, type LoadState } from "./PreviewState";
import { ToolbarButton } from "./ToolbarButton";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
// 滚动容器左右内边距合计，计算适应宽度时需扣除
const HORIZONTAL_PADDING = 64;

export function DocxPreview({ file }: PluginFilePreviewProps): JSX.Element {
	const { t } = useTranslation();
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const autoFitRef = useRef(true);
	const [status, setStatus] = useState<LoadState>("loading");
	const [zoom, setZoom] = useState(1);

	// 测量首页真实宽度（offsetWidth 不受 CSS zoom 影响），算出适应宽度的缩放
	const computeFitZoom = useCallback((): number => {
		const scroll = scrollRef.current;
		const page = containerRef.current?.querySelector<HTMLElement>("section.docx");
		if (!scroll || !page || page.offsetWidth <= 0) return 1;
		const available = scroll.clientWidth - HORIZONTAL_PADDING;
		return Math.max(MIN_ZOOM, Math.min(1, available / page.offsetWidth));
	}, []);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		let cancelled = false;
		container.replaceChildren();
		setStatus("loading");
		autoFitRef.current = true;
		void fetchFileBytes(file)
			.then((bytes) =>
				renderAsync(bytes, container, container, {
					inWrapper: true,
					breakPages: true,
					ignoreLastRenderedPageBreak: false,
					renderHeaders: true,
					renderFooters: true,
					renderFootnotes: true,
					renderEndnotes: true,
					renderComments: false,
					renderChanges: false,
					renderAltChunks: false,
					useBase64URL: false,
				}),
			)
			.then(
				() => {
					if (cancelled) return;
					setZoom(computeFitZoom());
					setStatus("ready");
				},
				() => {
					if (!cancelled) setStatus("error");
				},
			);
		return () => {
			cancelled = true;
			container.replaceChildren();
		};
	}, [file, computeFitZoom]);

	// 容器尺寸变化时，仅在「适应宽度」模式下重新计算
	useEffect(() => {
		const scroll = scrollRef.current;
		if (!scroll || status !== "ready") return;
		const observer = new ResizeObserver(() => {
			if (autoFitRef.current) setZoom(computeFitZoom());
		});
		observer.observe(scroll);
		return () => observer.disconnect();
	}, [status, computeFitZoom]);

	const adjustZoom = useCallback((delta: number) => {
		autoFitRef.current = false;
		setZoom((value) => {
			const next = Math.round((value + delta) * 100) / 100;
			return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
		});
	}, []);

	const fitToWidth = useCallback(() => {
		autoFitRef.current = true;
		setZoom(computeFitZoom());
	}, [computeFitZoom]);

	return (
		<div className="relative flex h-full min-h-0 flex-1 flex-col bg-[var(--background)]">
			<div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto bg-[var(--background)] px-8 pt-6 pb-16">
				<div ref={containerRef} style={{ zoom }} className="docx-host min-h-full" />
				{status === "loading" && (
					<div className="absolute inset-0 bg-[var(--background)]">
						<LoadingState />
					</div>
				)}
				{status === "error" && (
					<div className="absolute inset-0 bg-[var(--background)]">
						<ErrorState message={t("docx.error")} />
					</div>
				)}
			</div>
			<PreviewToolbar>
				<ToolbarButton label="−" disabled={zoom <= MIN_ZOOM} onClick={() => adjustZoom(-ZOOM_STEP)} />
				<button
					type="button"
					className="min-w-14 text-center text-[12px] tabular-nums text-[var(--muted-foreground)]"
					onClick={fitToWidth}
				>
					{Math.round(zoom * 100)}%
				</button>
				<ToolbarButton label="+" disabled={zoom >= MAX_ZOOM} onClick={() => adjustZoom(ZOOM_STEP)} />
				<div className="mx-1 h-4 w-px bg-[var(--border)]" />
				<ToolbarButton label={t("toolbar.fitWidth")} onClick={fitToWidth} />
			</PreviewToolbar>
		</div>
	);
}
