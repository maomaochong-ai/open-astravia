/** 一张导出图里排几个画框；超出的排到下一页。 */
export type FramesPerPage = 1 | 2 | 3 | 4;

export const FRAMES_PER_PAGE: readonly FramesPerPage[] = [1, 2, 3, 4];

/** User-facing export settings. Lengths are in layout units (see layout.ts). */
export interface MockupOptions {
	/** Screen corner radius. The device shell's outer radius adds borderWidth. */
	radius: number;
	/** Shell thickness, drawn OUTSIDE the screenshot so no pixel is covered. */
	borderWidth: number;
	borderColor: string;
	background: string;
	/** Export with an alpha background; `background` is then ignored. */
	transparent: boolean;
	shadow: boolean;
	/** Show the Astravia watermark. */
	brand: boolean;
	scale: 1 | 2;
	perPage: FramesPerPage;
}

/** One frame ready to be composed: manifest size for layout, bitmap for paint. */
export interface MockupShot {
	frameId: string;
	title: string;
	/** Manifest size in CSS px — layout normalizes on this, not on bitmap size. */
	cssWidth: number;
	cssHeight: number;
	/** null while the capture is in flight or after it failed — the slot is still laid out. */
	image: CanvasImageSource | null;
}

export interface MockupRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface MockupLayout {
	/** Canvas size in layout units; multiply by `scale * fit` for real pixels. */
	width: number;
	height: number;
	/** Screenshot rects (border sits outside these), in shot order. */
	rects: MockupRect[];
	brand: { x: number; y: number; logo: number } | null;
	/** Extra downscale applied when the export would exceed the pixel cap. */
	fit: number;
}
