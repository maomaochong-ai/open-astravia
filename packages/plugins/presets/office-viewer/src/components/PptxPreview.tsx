import {
	PptxViewer,
	buildPresentation,
	parseZip,
	type PresentationData,
	type SlideHandle,
	type ZipParseLimits,
} from "@aiden0z/pptx-renderer";
import { type PluginFilePreviewProps, useTranslation } from "@astravia-org/plugin-sdk";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { fetchFileBytes } from "../utils/file";
import { ErrorState, LoadingState } from "./PreviewState";

const ZIP_LIMITS: ZipParseLimits = {
	maxEntries: 20000,
	maxTotalUncompressedBytes: 256 * 1024 * 1024,
	maxEntryUncompressedBytes: 64 * 1024 * 1024,
};

type PptxStatus = "loading" | "parsing" | "ready" | "error";

export function PptxPreview({ file }: PluginFilePreviewProps): JSX.Element {
	const { t } = useTranslation();
	const [slideCount, setSlideCount] = useState(0);
	const [currentSlide, setCurrentSlide] = useState(0);
	const currentSlideRef = useRef(0);
	const [status, setStatus] = useState<PptxStatus>("loading");
	const [errorMsg, setErrorMsg] = useState("");
	const viewerRef = useRef<PptxViewer | null>(null);
	const presentationRef = useRef<PresentationData | null>(null);
	const slideContainerRef = useRef<HTMLDivElement>(null);
	const thumbnailTrackRef = useRef<HTMLDivElement>(null);
	const slideHandleRef = useRef<SlideHandle | null>(null);
	const thumbnailHandlesRef = useRef<Map<number, SlideHandle>>(new Map());
	const thumbRefs = useRef<Map<number, HTMLDivElement>>(new Map());

	// Phase 1: fetch + parse (no DOM needed)
	useEffect(() => {
		let cancelled = false;

		async function load() {
			try {
				setStatus("loading");
				setErrorMsg("");
				const buf = await fetchFileBytes(file);
				if (cancelled) return;

				setStatus("parsing");
				const parsed = await parseZip(buf, ZIP_LIMITS);
				if (cancelled) return;
				const presentation = await buildPresentation(parsed);
				if (cancelled) return;
				presentationRef.current = presentation;

				const count = presentation.slides?.length ?? 0;
				setSlideCount(count);
				setCurrentSlide(0);
				currentSlideRef.current = 0;
				setStatus("ready");
			} catch (e) {
				if (cancelled) return;
				const msg = e instanceof Error ? e.message : String(e);
				setErrorMsg(msg);
				setStatus("error");
			}
		}

		void load();
		return () => {
			cancelled = true;
		};
	}, [file]);

	const renderSlide = useCallback(async (index: number) => {
		const viewer = viewerRef.current;
		const presentation = presentationRef.current;
		const container = slideContainerRef.current;
		if (!viewer || !presentation || !container) return;

		const width = container.clientWidth;
		const height = container.clientHeight;
		if (width <= 1 || height <= 1) return;

		const scale = Math.min(width / presentation.width, height / presentation.height);

		slideHandleRef.current?.dispose();

		// The renderer lays slides out at their intrinsic size and only scales the
		// visual layer. A scaled-size stage keeps flex centering and clipping correct.
		const stage = document.createElement("div");
		stage.style.width = `${presentation.width * scale}px`;
		stage.style.height = `${presentation.height * scale}px`;
		stage.style.position = "relative";
		stage.style.overflow = "hidden";
		stage.style.flex = "0 0 auto";
		stage.style.background = "#fff";
		container.replaceChildren(stage);

		const handle = viewer.renderSlideToContainer(index, stage, scale);
		if (!handle) throw new Error(`Unable to render slide ${index + 1}`);
		slideHandleRef.current = handle;
		await handle.ready;
	}, []);

	// Phase 2: init viewer once DOM + presentation are both ready
	useEffect(() => {
		if (status !== "ready" || !presentationRef.current) return;
		const presentation = presentationRef.current;
		const mainContainer = slideContainerRef.current;
		if (!mainContainer) return;
		let cancelled = false;

		async function initViewer() {
			try {
				slideHandleRef.current?.dispose();
				slideHandleRef.current = null;
				for (const handle of thumbnailHandlesRef.current.values()) handle.dispose();
				thumbnailHandlesRef.current.clear();
				viewerRef.current?.destroy();

				// Keep the viewer's internal layout out of the visible preview.
				// The visible container must only receive one external slide render.
				const viewerHost = document.createElement("div");
				const viewer = new PptxViewer(viewerHost, {
					fitMode: "contain",
				});
				viewerRef.current = viewer;
				viewer.load(presentation);

				// Wait until the host preview has completed its layout transition.
				await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
				if (cancelled) return;
				await renderSlide(currentSlideRef.current);
				if (cancelled) return;

				for (let i = 0; i < (presentation.slides?.length ?? 0); i++) {
					const el = thumbRefs.current.get(i);
					if (el) {
						const handle = viewer.renderThumbnailToContainer(i, el, { width: 176 });
						if (handle) thumbnailHandlesRef.current.set(i, handle);
					}
				}
				await Promise.allSettled(
					Array.from(thumbnailHandlesRef.current.values(), (handle) => handle.ready),
				);
			} catch (e) {
				if (cancelled) return;
				const msg = e instanceof Error ? e.message : String(e);
				setErrorMsg(msg);
				setStatus("error");
			}
		}

		void initViewer();
		return () => {
			cancelled = true;
		};
	}, [status, renderSlide]);

	useEffect(() => {
		if (status !== "ready") return;
		const container = slideContainerRef.current;
		if (!container) return;

		let timer: number | undefined;
		let lastWidth = Math.round(container.clientWidth);
		let lastHeight = Math.round(container.clientHeight);
		const observer = new ResizeObserver(([entry]) => {
			const width = Math.round(entry.contentRect.width);
			const height = Math.round(entry.contentRect.height);
			if (width <= 1 || height <= 1 || (width === lastWidth && height === lastHeight)) return;
			lastWidth = width;
			lastHeight = height;
			window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				void renderSlide(currentSlideRef.current).catch(() => {
					// Resize re-render failures are non-fatal; next interaction can retry.
				});
			}, 120);
		});

		observer.observe(container);
		return () => {
			observer.disconnect();
			window.clearTimeout(timer);
		};
	}, [status, renderSlide]);

	const selectSlide = useCallback(
		async (index: number) => {
			const viewer = viewerRef.current;
			if (!viewer || index === currentSlideRef.current) return;
			currentSlideRef.current = index;
			setCurrentSlide(index);
			try {
				await renderSlide(index);
			} catch {
				// Keep current slide index; user can retry by clicking again.
			}
		},
		[renderSlide],
	);

	// Cleanup viewer on unmount
	useEffect(() => {
		return () => {
			slideHandleRef.current?.dispose();
			slideHandleRef.current = null;
			for (const handle of thumbnailHandlesRef.current.values()) handle.dispose();
			thumbnailHandlesRef.current.clear();
			viewerRef.current?.destroy();
			viewerRef.current = null;
		};
	}, []);

	const scrollThumbnails = useCallback((direction: "prev" | "next") => {
		thumbnailTrackRef.current?.scrollBy({
			left: direction === "next" ? 220 : -220,
			behavior: "smooth",
		});
	}, []);

	if (status === "error") {
		return (
			<ErrorState message={errorMsg ? `${t("pptx.error")}: ${errorMsg}` : t("pptx.error")} />
		);
	}

	// Always render the main layout even during loading/parsing;
	// the slide container ref must exist before the viewer is created.
	return (
		<div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--background)]">
			<div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden p-6">
				<div
					ref={slideContainerRef}
					className="flex h-full w-full max-w-full items-center justify-center overflow-hidden [&>div]:rounded-md [&>div]:shadow-lg"
				/>
				{(status === "loading" || status === "parsing") && (
					<div className="absolute inset-0 flex items-center justify-center bg-[var(--background)]">
						<LoadingState />
					</div>
				)}
			</div>

			<div
				className="relative flex-shrink-0 border-t border-[var(--border)] bg-[var(--background)]"
				style={{ height: 142 }}
			>
				<button
					type="button"
					aria-label={t("pptx.thumbPrev")}
					onClick={() => scrollThumbnails("prev")}
					className="absolute left-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--background)] text-lg text-[var(--foreground)] shadow-md transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]"
				>
					‹
				</button>
				<button
					type="button"
					aria-label={t("pptx.thumbNext")}
					onClick={() => scrollThumbnails("next")}
					className="absolute right-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--background)] text-lg text-[var(--foreground)] shadow-md transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)]"
				>
					›
				</button>

				<div
					ref={thumbnailTrackRef}
					className="h-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:!hidden [&::-webkit-scrollbar]:!h-0"
					style={{ scrollbarWidth: "none" }}
				>
					{status === "loading" || status === "parsing" ? (
						<div className="flex h-full items-center justify-center">
							<LoadingState />
						</div>
					) : (
						<div className="flex h-full w-max items-center gap-3 px-14 py-3">
							{Array.from({ length: slideCount }, (_, i) => (
								<button
									key={i}
									type="button"
									aria-label={t("pptx.slideLabel", { page: i + 1 })}
									onClick={() => void selectSlide(i)}
									className="relative h-[108px] w-[176px] flex-shrink-0 overflow-hidden rounded-md transition-all duration-150"
									style={{
										outline:
											i === currentSlide ? "2.5px solid var(--accent)" : "2px solid var(--border)",
										outlineOffset: "1px",
										opacity: i === currentSlide ? 1 : 0.7,
										boxShadow:
											i === currentSlide
												? "0 0 12px color-mix(in srgb, var(--accent) 35%, transparent)"
												: "none",
									}}
								>
									<div
										ref={(el) => {
											if (el) {
												thumbRefs.current.set(i, el);
											} else {
												// React rebinds inline callback refs after selection state updates.
												// Keep the rendered handle alive; unmount cleanup disposes it.
												thumbRefs.current.delete(i);
											}
										}}
										className="h-full w-full [&_canvas]:!h-full [&_canvas]:!w-full [&_canvas]:object-contain"
									/>
									<span
										className="absolute bottom-1 right-1 rounded px-1 text-[10px] font-medium"
										style={{
											color: i === currentSlide ? "var(--accent)" : "var(--muted-foreground)",
											backgroundColor: "color-mix(in srgb, var(--background) 80%, transparent)",
										}}
									>
										{i + 1}
									</span>
								</button>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
