export const H3_RESOLUTION_IDS = ["0_5mp", "0_75mp", "1mp"] as const;

export type H3ResolutionId = (typeof H3_RESOLUTION_IDS)[number];

export interface H3ResolutionPreset {
	id: H3ResolutionId;
	sizing:
		| { kind: "megapixels"; value: number }
		| { kind: "long-edge"; pixels: number };
}

export interface H3CanvasResolution {
	width: number;
	height: number;
	megapixels: number;
}

export const H3_DEFAULT_RESOLUTION: H3ResolutionId = "0_75mp";
export const H3_CANVAS_MULTIPLE = 32;

const H3_RESOLUTION_PRESETS: Readonly<Record<H3ResolutionId, H3ResolutionPreset>> = {
	"0_5mp": { id: "0_5mp", sizing: { kind: "megapixels", value: 0.5 } },
	"0_75mp": { id: "0_75mp", sizing: { kind: "megapixels", value: 0.75 } },
	// Keep the persisted id stable; the user-facing 2K tier uses a real 2048px long edge.
	"1mp": { id: "1mp", sizing: { kind: "long-edge", pixels: 2048 } },
};

export function resolveH3ResolutionPreset(value: string | undefined): H3ResolutionPreset {
	const normalized = value === undefined || value === "720p" ? H3_DEFAULT_RESOLUTION : value;
	if (isH3ResolutionId(normalized)) return H3_RESOLUTION_PRESETS[normalized];
	throw new Error(`Unsupported MiniMax H3 resolution preset: ${value}`);
}

export function calculateH3CanvasResolution(
	aspectRatio: string | undefined,
	preset: H3ResolutionPreset,
	fallback: { width: number; height: number },
): H3CanvasResolution {
	const ratio = parseAspectRatio(aspectRatio) ?? fallback.width / fallback.height;
	const megapixels = resolveMegapixels(preset, ratio);
	const totalPixels = megapixels * 1024 * 1024;
	const height = Math.sqrt(totalPixels / ratio);
	return {
		width: alignDimension(height * ratio),
		height: alignDimension(height),
		megapixels,
	};
}

function isH3ResolutionId(value: string): value is H3ResolutionId {
	return (H3_RESOLUTION_IDS as readonly string[]).includes(value);
}

function parseAspectRatio(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const match = /^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)(?:\s|\(|$)/.exec(value);
	if (!match) return undefined;
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (!(width > 0) || !(height > 0)) return undefined;
	return width / height;
}

function resolveMegapixels(preset: H3ResolutionPreset, ratio: number): number {
	if (preset.sizing.kind === "megapixels") return preset.sizing.value;
	const longEdgeIn1024Pixels = preset.sizing.pixels / 1024;
	const squareMegapixels = longEdgeIn1024Pixels ** 2;
	return ratio >= 1 ? squareMegapixels / ratio : squareMegapixels * ratio;
}

function alignDimension(value: number): number {
	return Math.max(H3_CANVAS_MULTIPLE, Math.round(value / H3_CANVAS_MULTIPLE) * H3_CANVAS_MULTIPLE);
}
