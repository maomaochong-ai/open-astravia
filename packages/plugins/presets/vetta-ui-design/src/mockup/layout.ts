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

/**
 * @param slots 这一行留几个位置。默认就是画框数；分页时传每页的固定格数，
 * 末页画框不满也照样占满宽度，多页叠起来才不会一页宽一页窄。空位按本页画框
 * 的平均宽度计价——同一份设计稿里画框尺寸通常一致，这就等于「少的那几格」。
 */
export function layoutMockup(shots: MockupShot[], options: MockupOptions, slots = shots.length): MockupLayout {
	if (shots.length === 0) return { width: 0, height: 0, rects: [], brand: null, fit: 1 };

	const normalizedHeight = Math.max(...shots.map((shot) => shot.cssHeight));
	const gap = normalizedHeight * GAP_RATIO;
	const padding = normalizedHeight * PADDING_RATIO;
	const border = Math.max(0, options.borderWidth);

	const widths = shots.map((shot) => (shot.cssWidth / shot.cssHeight) * normalizedHeight);
	const columns = Math.max(shots.length, Math.floor(slots));
	const emptyWidth = widths.reduce((sum, width) => sum + width, 0) / widths.length;
	const rowWidth =
		widths.reduce((sum, width) => sum + width + 2 * border, 0) +
		(columns - shots.length) * (emptyWidth + 2 * border) +
		gap * (columns - 1);

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
