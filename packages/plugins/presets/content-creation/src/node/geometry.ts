import type { ContentNodeKind } from "../project/types";

export interface ContentNodeSize {
	width: number;
	height: number;
}

const DEFAULT_NODE_SIZES: Record<ContentNodeKind, ContentNodeSize> = {
	prompt: { width: 320, height: 180 },
	"image-generator": { width: 400, height: 400 },
	"video-generator": { width: 400, height: 225 },
	asset: { width: 360, height: 240 },
	output: { width: 280, height: 150 },
};

export function parseContentAspectRatio(value: string | undefined): number | null {
	if (!value) return null;
	const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value.trim());
	if (!match) return null;
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
	return width / height;
}

export function getContentNodeSize(kind: ContentNodeKind, aspectRatio?: string): ContentNodeSize {
	const fallback = DEFAULT_NODE_SIZES[kind];
	if (kind !== "image-generator" && kind !== "video-generator") return { ...fallback };
	const ratio = parseContentAspectRatio(aspectRatio);
	if (!ratio) return { ...fallback };
	const maxDimension = 400;
	return ratio >= 1
		? { width: maxDimension, height: Math.round(maxDimension / ratio) }
		: { width: Math.round(maxDimension * ratio), height: maxDimension };
}
