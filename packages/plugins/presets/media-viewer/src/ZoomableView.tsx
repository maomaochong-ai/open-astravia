import { useTranslation } from "@vetta-org/plugin-sdk";
import type { JSX, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PreviewToolbar } from "./PreviewToolbar";
import { ToolbarButton } from "./ToolbarButton";
import { cn } from "./utils";
import {
	MAX_SCALE,
	MIN_SCALE,
	type Point,
	type Size,
	clampOffset,
	clampScale,
	computeFit,
	zoomAround,
} from "./zoom-math";

const ZOOM_FACTOR = 1.25;
const WHEEL_ZOOM_SENSITIVITY = 0.0018;
const FIT_EPS = 0.01;

interface ZoomableViewProps {
	/** Natural pixel size of the content; used for fit + absolute transform scale. */
	naturalSize: Size | null;
	children: ReactNode;
}

export function ZoomableView({ naturalSize, children }: ZoomableViewProps): JSX.Element {
	const { t } = useTranslation();
	const containerRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);

	const [scale, setScale] = useState(1);
	const [fitScale, setFitScale] = useState(1);
	const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
	const [isPanning, setIsPanning] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [autoFit, setAutoFit] = useState(true);

	const scaleRef = useRef(scale);
	const offsetRef = useRef(offset);
	const fitScaleRef = useRef(fitScale);
	const autoFitRef = useRef(true);
	const isPanningRef = useRef(false);
	const sizeRef = useRef<Size | null>(null);
	const natRef = useRef<Size | null>(null);
	const panStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

	const commit = useCallback((nextScale: number, nextOffset: Point, opts?: { keepAutoFit?: boolean }) => {
		const nat = natRef.current;
		const size = sizeRef.current;
		let offsetValue = nextOffset;
		if (nat && size) {
			offsetValue = clampOffset(nextOffset, nextScale, size.width, size.height, nat.width, nat.height);
		}
		scaleRef.current = nextScale;
		offsetRef.current = offsetValue;
		setScale(nextScale);
		setOffset(offsetValue);
		if (!opts?.keepAutoFit) {
			autoFitRef.current = false;
			setAutoFit(false);
		}
	}, []);

	const applyFit = useCallback(() => {
		const size = sizeRef.current;
		const nat = natRef.current;
		if (!size || !nat) return;
		const fit = computeFit(size.width, size.height, nat.width, nat.height);
		if (!fit) return;
		autoFitRef.current = true;
		setAutoFit(true);
		fitScaleRef.current = fit.scale;
		setFitScale(fit.scale);
		scaleRef.current = fit.scale;
		offsetRef.current = fit.offset;
		setScale(fit.scale);
		setOffset(fit.offset);
	}, []);

	useEffect(() => {
		natRef.current = naturalSize;
		if (naturalSize) {
			autoFitRef.current = true;
			setAutoFit(true);
			applyFit();
		}
	}, [naturalSize, applyFit]);

	// Focus so + / - / 0 work without an extra click after open.
	useEffect(() => {
		containerRef.current?.focus({ preventScroll: true });
	}, [naturalSize]);

	useEffect(() => {
		const el = viewportRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			const rect = entries[0]?.contentRect;
			if (!rect) return;
			sizeRef.current = { width: rect.width, height: rect.height };
			if (autoFitRef.current) {
				applyFit();
			} else {
				commit(scaleRef.current, offsetRef.current, { keepAutoFit: true });
			}
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [applyFit, commit]);

	// Wheel → zoom toward cursor.
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const rect = container.getBoundingClientRect();
			const anchorX = e.clientX - rect.left;
			const anchorY = e.clientY - rect.top;
			const prev = scaleRef.current;
			const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
			const delta = -e.deltaY * unit * WHEEL_ZOOM_SENSITIVITY;
			const next = clampScale(prev * Math.exp(delta));
			const zoomed = zoomAround(prev, next, offsetRef.current, anchorX, anchorY);
			commit(zoomed.scale, zoomed.offset);
		};

		container.addEventListener("wheel", onWheel, { passive: false });
		return () => container.removeEventListener("wheel", onWheel);
	}, [commit]);

	// Keyboard: + / - / 0 when focused.
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && isFullscreen) {
				e.preventDefault();
				e.stopPropagation();
				setIsFullscreen(false);
				return;
			}
			const size = sizeRef.current;
			if (!size) return;
			const cx = size.width / 2;
			const cy = size.height / 2;
			if (e.key === "+" || e.key === "=") {
				e.preventDefault();
				const prev = scaleRef.current;
				const zoomed = zoomAround(prev, prev * ZOOM_FACTOR, offsetRef.current, cx, cy);
				commit(zoomed.scale, zoomed.offset);
			} else if (e.key === "-" || e.key === "_") {
				e.preventDefault();
				const prev = scaleRef.current;
				const zoomed = zoomAround(prev, prev / ZOOM_FACTOR, offsetRef.current, cx, cy);
				commit(zoomed.scale, zoomed.offset);
			} else if (e.key === "0") {
				e.preventDefault();
				applyFit();
			}
		};

		container.addEventListener("keydown", onKeyDown);
		return () => container.removeEventListener("keydown", onKeyDown);
	}, [applyFit, commit, isFullscreen]);

	useEffect(() => {
		if (!isFullscreen) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				setIsFullscreen(false);
			}
		};
		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	}, [isFullscreen]);

	/**
	 * Pan via document listeners + refs (not React isPanning state on move).
	 * React state lags one frame after pointerdown, so onPointerMove that
	 * gates on `isPanning` drops the whole drag — felt like "left drag dead".
	 */
	const onPointerDown = useCallback(
		(e: ReactPointerEvent) => {
			if (e.button !== 0) return;
			if ((e.target as HTMLElement).closest("button")) return;

			e.preventDefault();
			e.stopPropagation();

			isPanningRef.current = true;
			setIsPanning(true);
			panStartRef.current = {
				x: e.clientX,
				y: e.clientY,
				ox: offsetRef.current.x,
				oy: offsetRef.current.y,
			};

			const onMove = (ev: PointerEvent) => {
				if (!isPanningRef.current) return;
				ev.preventDefault();
				const dx = ev.clientX - panStartRef.current.x;
				const dy = ev.clientY - panStartRef.current.y;
				commit(scaleRef.current, {
					x: panStartRef.current.ox + dx,
					y: panStartRef.current.oy + dy,
				});
			};
			const onUp = () => {
				isPanningRef.current = false;
				setIsPanning(false);
				document.removeEventListener("pointermove", onMove);
				document.removeEventListener("pointerup", onUp);
				document.removeEventListener("pointercancel", onUp);
			};

			document.addEventListener("pointermove", onMove);
			document.addEventListener("pointerup", onUp);
			document.addEventListener("pointercancel", onUp);
		},
		[commit],
	);

	const onDoubleClick = useCallback(
		(e: React.MouseEvent) => {
			if ((e.target as HTMLElement).closest("button")) return;
			const container = containerRef.current;
			const size = sizeRef.current;
			if (!container || !size) return;
			const rect = container.getBoundingClientRect();
			const ax = e.clientX - rect.left;
			const ay = e.clientY - rect.top;
			const prev = scaleRef.current;
			const fit = fitScaleRef.current;

			if (Math.abs(prev - fit) <= FIT_EPS * Math.max(fit, 0.01)) {
				const target = fit >= 1 - FIT_EPS ? 2 : 1;
				const zoomed = zoomAround(prev, target, offsetRef.current, ax, ay);
				commit(zoomed.scale, zoomed.offset);
			} else {
				applyFit();
			}
		},
		[applyFit, commit],
	);

	const zoomIn = useCallback(() => {
		const size = sizeRef.current;
		if (!size) return;
		const prev = scaleRef.current;
		const zoomed = zoomAround(prev, prev * ZOOM_FACTOR, offsetRef.current, size.width / 2, size.height / 2);
		commit(zoomed.scale, zoomed.offset);
	}, [commit]);

	const zoomOut = useCallback(() => {
		const size = sizeRef.current;
		if (!size) return;
		const prev = scaleRef.current;
		const zoomed = zoomAround(prev, prev / ZOOM_FACTOR, offsetRef.current, size.width / 2, size.height / 2);
		commit(zoomed.scale, zoomed.offset);
	}, [commit]);

	const toggleFullscreen = useCallback(() => setIsFullscreen((value) => !value), []);

	const pct = Math.max(1, Math.round((scale / (fitScale || 1)) * 100));

	return (
		<div
			ref={containerRef}
			tabIndex={0}
			className={cn(
				"outline-none select-none",
				isFullscreen
					? "fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--background)]"
					: "relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--background)]",
			)}
			style={{ touchAction: "none" }}
			onPointerDown={onPointerDown}
			onDoubleClick={onDoubleClick}
		>
			<div
				ref={viewportRef}
				className="relative min-h-0 flex-1 overflow-hidden"
				style={{ cursor: isPanning ? "grabbing" : "grab" }}
			>
				<div
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						width: naturalSize?.width,
						height: naturalSize?.height,
						transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
						transformOrigin: "0 0",
						willChange: "transform",
						pointerEvents: "none",
					}}
				>
					{children}
				</div>
			</div>

			<PreviewToolbar>
				<ToolbarButton
					icon="icon-[mdi--magnify-minus-outline]"
					title={t("zoom.out")}
					onClick={zoomOut}
					disabled={scale <= MIN_SCALE}
				/>
				<button
					type="button"
					onClick={applyFit}
					title={t("zoom.reset")}
					className="min-w-12 rounded-full px-1.5 text-center text-[12px] tabular-nums text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
				>
					{pct}%
				</button>
				<ToolbarButton
					icon="icon-[mdi--magnify-plus-outline]"
					title={t("zoom.in")}
					onClick={zoomIn}
					disabled={scale >= MAX_SCALE}
				/>
				<div className="mx-0.5 h-4 w-px bg-[var(--border)]" />
				<ToolbarButton
					icon={isFullscreen ? "icon-[mdi--fullscreen-exit]" : "icon-[mdi--fullscreen]"}
					title={isFullscreen ? t("fullscreen.exit") : t("fullscreen.enter")}
					onClick={toggleFullscreen}
				/>
				{!autoFit && (
					<>
						<div className="mx-0.5 h-4 w-px bg-[var(--border)]" />
						<ToolbarButton
							icon="icon-[mdi--fit-to-page-outline]"
							title={t("view.resetTitle")}
							onClick={applyFit}
						/>
					</>
				)}
			</PreviewToolbar>
		</div>
	);
}
