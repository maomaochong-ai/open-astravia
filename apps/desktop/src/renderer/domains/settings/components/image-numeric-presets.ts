/** One common value shown for an image-processing number, before Custom. */
export interface ImageNumericPreset {
	readonly value: number;
	readonly label: string;
}

const px = (value: number): ImageNumericPreset => ({ value, label: `${value} px` });
const kb = (value: number): ImageNumericPreset => ({ value: value * 1024, label: `${value} KB` });
const mb = (value: number): ImageNumericPreset => ({ value: value * 1024 * 1024, label: `${value} MB` });
const mp = (value: number): ImageNumericPreset => ({ value: value * 1_000_000, label: `${value} MP` });
const quality = (value: number): ImageNumericPreset => ({ value, label: String(value) });

/**
 * Common choices for each numeric image-processing field. The shipped default of
 * every field is included, so a fresh install shows a preset rather than Custom.
 * Custom stays outside this list and is always appended by the control.
 */
export const IMAGE_NUMERIC_PRESETS: Record<string, readonly ImageNumericPreset[]> = {
	"resize.maxWidth": [px(512), px(768), px(1024), px(1280), px(1536), px(2048)],
	"resize.maxHeight": [px(512), px(768), px(1024), px(1280), px(1536), px(2048)],
	"resize.maxInputPixels": [mp(16), mp(36), mp(64), mp(100)],
	"resize.maxInputEdge": [px(4096), px(8192), px(12000), px(16384)],
	"resize.maxBytes": [kb(512), mb(1), mb(2), mb(4), mb(8)],
	"resize.jpegQuality": [quality(50), quality(60), quality(70), quality(80), quality(90), quality(100)],
	"requestBudget.highWatermarkBytes": [mb(8), mb(12), mb(16), mb(24), mb(32)],
	"requestBudget.lowWatermarkBytes": [mb(4), mb(8), mb(12), mb(16), mb(24)],
};

/** Select value that reveals the custom number field. Not a stored configuration value. */
export const IMAGE_CUSTOM_PRESET = "__custom__";

export function imageNumericPresets(path: readonly string[]): readonly ImageNumericPreset[] | undefined {
	return IMAGE_NUMERIC_PRESETS[path.join(".")];
}
