export const MIN_SCALE = 0.05;
export const MAX_SCALE = 32;
export const FIT_PADDING = 16;
/** Keep at least this many pixels of the image inside the viewport when clamping pan. */
export const PAN_EDGE = 48;

export interface Size {
	width: number;
	height: number;
}

export interface Point {
	x: number;
	y: number;
}

export function clampScale(value: number): number {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

/**
 * Contain image in viewport (width and height), never upscale past 1× natural pixels.
 * Centers when either axis has spare room.
 */
export function computeFit(
	vw: number,
	vh: number,
	iw: number,
	ih: number,
	padding = FIT_PADDING,
): { scale: number; offset: Point } | null {
	if (!(vw > 0 && vh > 0 && iw > 0 && ih > 0)) return null;
	const availW = Math.max(1, vw - padding * 2);
	const availH = Math.max(1, vh - padding * 2);
	const scale = Math.min(1, availW / iw, availH / ih);
	const sw = iw * scale;
	const sh = ih * scale;
	return {
		scale,
		offset: {
			x: (vw - sw) / 2,
			y: (vh - sh) / 2,
		},
	};
}

/**
 * Soft pan bounds: keep at least `PAN_EDGE` px of the image inside the viewport.
 * Does NOT force-center when content is smaller than the viewport — that was
 * killing left-drag at fit scale (every move snapped back to center).
 */
export function clampOffset(offset: Point, scale: number, vw: number, vh: number, iw: number, ih: number): Point {
	const sw = iw * scale;
	const sh = ih * scale;
	return {
		x: clampAxis(offset.x, sw, vw),
		y: clampAxis(offset.y, sh, vh),
	};
}

function clampAxis(value: number, size: number, viewport: number): number {
	// Keep ≥ PAN_EDGE of the image inside the viewport on this axis:
	// value ∈ [edge - size, viewport - edge]
	const lo = PAN_EDGE - size;
	const hi = viewport - PAN_EDGE;
	if (lo > hi) {
		// Degenerate (edge*2 > viewport): pin to center.
		return (viewport - size) / 2;
	}
	return Math.min(hi, Math.max(lo, value));
}

/** Zoom so the point under (anchorX, anchorY) in viewport coords stays put. */
export function zoomAround(
	prevScale: number,
	nextScale: number,
	offset: Point,
	anchorX: number,
	anchorY: number,
): { scale: number; offset: Point } {
	const scale = clampScale(nextScale);
	if (scale === prevScale || prevScale <= 0) {
		return { scale: prevScale, offset };
	}
	const ratio = scale / prevScale;
	return {
		scale,
		offset: {
			x: anchorX - ratio * (anchorX - offset.x),
			y: anchorY - ratio * (anchorY - offset.y),
		},
	};
}
