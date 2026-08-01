import { DEFAULT_FRAME_META, type FrameMeta } from "./manifest-types";

/**
 * Parse `export const frame = { width: 390, height: 844, title: "登录" }` from
 * tsx source text. Regex-based on purpose: the meta object is a flat literal by
 * convention (enforced by the skill), and a parse miss just falls back to
 * defaults — never breaks the canvas.
 */
export function parseFrameMeta(source: string, fallbackTitle: string): FrameMeta {
	const match = source.match(/export\s+const\s+frame\s*=\s*\{([^}]*)\}/);
	const body = match?.[1] ?? "";
	const width = body.match(/width\s*:\s*(\d+)/);
	const height = body.match(/height\s*:\s*(\d+)/);
	const title = body.match(/title\s*:\s*["'`]([^"'`]*)["'`]/);
	return {
		width: width ? Number(width[1]) : DEFAULT_FRAME_META.width,
		height: height ? Number(height[1]) : DEFAULT_FRAME_META.height,
		title: title?.[1] ?? fallbackTitle,
	};
}

export function sameMeta(a: FrameMeta, b: FrameMeta): boolean {
	return a.width === b.width && a.height === b.height && a.title === b.title;
}
