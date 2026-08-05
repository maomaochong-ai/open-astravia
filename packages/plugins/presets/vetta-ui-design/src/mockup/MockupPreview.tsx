import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { layoutMockup } from "./layout";
import { renderMockup } from "./render";
import type { MockupOptions, MockupShot } from "./types";

interface MockupPreviewProps {
	shots: MockupShot[];
	options: MockupOptions;
	brandLogo: CanvasImageSource | null;
	/** Per-shot capture error, keyed by frame id. */
	errors: ReadonlyMap<string, string>;
	onRetry(frameId: string): void;
	/** Figma-style: dropping A onto B swaps the two. Indices are page-local. */
	onSwap(fromIndex: number, toIndex: number): void;
}

/**
 * The composition, drawn by the same renderer the export uses. Hit testing does
 * not duplicate any geometry: the layout's rects are rendered a second time as
 * transparent divs that own hover, drag-to-swap and the retry affordance.
 */
export function MockupPreview({ shots, options, brandLogo, errors, onRetry, onSwap }: MockupPreviewProps) {
	const { t } = useTranslation();
	const boxRef = useRef<HTMLDivElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const [box, setBox] = useState({ width: 0 });
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [overIndex, setOverIndex] = useState<number | null>(null);

	useEffect(() => {
		const element = boxRef.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => {
			setBox({ width: entry.contentRect.width });
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const layout = useMemo(() => layoutMockup(shots, options), [shots, options]);
	// Fit on width only: pages stack in a scroller, so height is free.
	const k = layout.width > 0 && box.width > 0 ? Math.min(box.width / layout.width, 1) : 0;

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || k <= 0) return;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.max(1, Math.round(layout.width * k * dpr));
		canvas.height = Math.max(1, Math.round(layout.height * k * dpr));
		const g = canvas.getContext("2d");
		if (!g) return;
		renderMockup(g, shots, options, layout, k * dpr, brandLogo);
	}, [shots, options, layout, k, brandLogo]);

	return (
		<div ref={boxRef} className="flex w-full justify-center">
			{k > 0 ? (
				<div
					className={`relative ${options.transparent ? "vetd-checkerboard" : ""}`}
					style={{ width: layout.width * k, height: layout.height * k }}
				>
					<canvas
						ref={canvasRef}
						className="block h-full w-full"
						aria-label={t("mockup.preview.alt")}
						role="img"
					/>
					{layout.rects.map((rect, index) => {
						const shot = shots[index];
						if (!shot) return null;
						const error = errors.get(shot.frameId);
						return (
							// biome-ignore lint/a11y/noStaticElementInteractions: drag-to-reorder surface over the canvas
							<div
								key={shot.frameId}
								draggable={!error}
								onDragStart={() => setDragIndex(index)}
								onDragEnd={() => {
									setDragIndex(null);
									setOverIndex(null);
								}}
								onDragOver={(event) => {
									event.preventDefault();
									if (dragIndex !== null && dragIndex !== index) setOverIndex(index);
								}}
								onDragLeave={() => setOverIndex((current) => (current === index ? null : current))}
								onDrop={(event) => {
									event.preventDefault();
									if (dragIndex !== null && dragIndex !== index) onSwap(dragIndex, index);
									setDragIndex(null);
									setOverIndex(null);
								}}
								title={shot.title}
								className={`absolute flex items-center justify-center rounded-md transition-colors ${
									error
										? "bg-black/55"
										: overIndex === index
											? "cursor-grabbing ring-2 ring-primary"
											: dragIndex === index
												? "cursor-grabbing opacity-60"
												: "cursor-grab hover:ring-2 hover:ring-primary/50"
								}`}
								style={{
									left: rect.x * k,
									top: rect.y * k,
									width: rect.width * k,
									height: rect.height * k,
								}}
							>
								{error ? (
									<div className="flex flex-col items-center gap-2 p-3 text-center">
										<span className="text-xs font-medium text-white">{t("mockup.shot.failed")}</span>
										<span className="line-clamp-2 text-[10px] text-white/70">{error}</span>
										<button
											type="button"
											onClick={() => onRetry(shot.frameId)}
											className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
										>
											{t("mockup.shot.retry")}
										</button>
									</div>
								) : null}
							</div>
						);
					})}
				</div>
			) : null}
		</div>
	);
}
