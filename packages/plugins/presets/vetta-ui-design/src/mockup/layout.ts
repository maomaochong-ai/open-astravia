import type { MockupLayout, MockupOptions, MockupShot } from "./types";

/**
 * Composition geometry, shared by the preview and the export so the two can
 * never drift. Everything is expressed in "layout units": the units the user's
 * radius / border sliders speak in. Real pixels = layout unit × scale × fit.
 *
 * Shots are laid out in one row, normalized to a common height (the tallest
 * shot's own height, so nothing is ever scaled DOWN and loses detail).
 */

/** Spacing as a fraction of the normalized shot height. */
const GAP_RATIO = 0.06;
const PADDING_RATIO = 0.1;
/** Brand block height, also relative to the normalized height. */
const BRAND_LOGO_RATIO = 0.09;
const BRAND_GAP_RATIO = 0.06;
/** Hard ceiling per side; beyond this Chromium canvases get unreliable. */
const MAX_OUTPUT_PX = 8000;

export function layoutMockup(shots: MockupShot[], options: MockupOptions): MockupLayout {
	if (shots.length === 0) return { width: 0, height: 0, rects: [], brand: null, fit: 1 };

	const normalizedHeight = Math.max(...shots.map((shot) => shot.cssHeight));
	const gap = normalizedHeight * GAP_RATIO;
	const padding = normalizedHeight * PADDING_RATIO;
	const border = Math.max(0, options.borderWidth);

	const widths = shots.map((shot) => (shot.cssWidth / shot.cssHeight) * normalizedHeight);
	const rowWidth = widths.reduce((sum, width) => sum + width + 2 * border, 0) + gap * (shots.length - 1);

	const logo = normalizedHeight * BRAND_LOGO_RATIO;
	const brandHeight = options.brand ? logo + normalizedHeight * BRAND_GAP_RATIO : 0;

	const width = rowWidth + padding * 2;
	const height = normalizedHeight + 2 * border + brandHeight + padding * 2;

	const rects = [];
	let cursor = padding + border;
	const top = padding + brandHeight + border;
	for (const shotWidth of widths) {
		rects.push({ x: cursor, y: top, width: shotWidth, height: normalizedHeight });
		cursor += shotWidth + 2 * border + gap;
	}

	const fit = Math.min(1, MAX_OUTPUT_PX / (width * options.scale), MAX_OUTPUT_PX / (height * options.scale));

	return {
		width,
		height,
		rects,
		brand: options.brand ? { x: padding, y: padding, logo } : null,
		fit,
	};
}
