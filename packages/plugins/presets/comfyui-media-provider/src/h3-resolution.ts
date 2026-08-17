export const H3_RESOLUTION_IDS = ["0_5mp", "0_75mp", "1mp"] as const;

export type H3ResolutionId = (typeof H3_RESOLUTION_IDS)[number];

export interface H3ResolutionPreset {
	id: H3ResolutionId;
	megapixels: number;
}

export const H3_DEFAULT_RESOLUTION: H3ResolutionId = "0_75mp";
export const H3_CANVAS_MULTIPLE = 32;

const H3_RESOLUTION_PRESETS: Readonly<Record<H3ResolutionId, H3ResolutionPreset>> = {
	"0_5mp": { id: "0_5mp", megapixels: 0.5 },
	"0_75mp": { id: "0_75mp", megapixels: 0.75 },
	// 0.98 rounds a 16:9 canvas to the model's native 1344x768 default at a multiple of 32.
	"1mp": { id: "1mp", megapixels: 0.98 },
};

export function resolveH3ResolutionPreset(value: string | undefined): H3ResolutionPreset {
	const normalized = value === undefined || value === "720p" ? H3_DEFAULT_RESOLUTION : value;
	if (isH3ResolutionId(normalized)) return H3_RESOLUTION_PRESETS[normalized];
	throw new Error(`Unsupported MiniMax H3 resolution preset: ${value}`);
}

export function calculateH3Dimensions(
	aspectRatio: string | undefined,
	megapixels: number,
	fallback: { width: number; height: number },
): { width: number; height: number } {
	const ratio = parseAspectRatio(aspectRatio) ?? fallback.width / fallback.height;
	const totalPixels = megapixels * 1024 * 1024;
	const height = Math.sqrt(totalPixels / ratio);
	return {
		width: alignDimension(height * ratio),
		height: alignDimension(height),
	};
}

function isH3ResolutionId(value: string): value is H3ResolutionId {
	return (H3_RESOLUTION_IDS as readonly string[]).includes(value);
}

function parseAspectRatio(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const [width, height, ...extra] = value.split(":").map(Number);
	if (extra.length > 0 || !(width > 0) || !(height > 0)) return undefined;
	return width / height;
}

function alignDimension(value: number): number {
	return Math.max(H3_CANVAS_MULTIPLE, Math.round(value / H3_CANVAS_MULTIPLE) * H3_CANVAS_MULTIPLE);
}
