import { getReasoningPreset } from "@vetta/ai/reasoning-presets";
import type { ModelOption } from "./useModelOptions";

export interface ResolvedReasoning {
	/** Selectable reasoning level values for this model, in display order */
	levels: string[];
	/** Default level when the user has not chosen one */
	default: string;
}

/**
 * Resolve a model's selectable reasoning levels:
 *  - explicit `reasoningLevels` from config win;
 *  - otherwise fall back to the api-type preset (source of truth in @vetta/ai);
 *  - non-reasoning models (no levels, no preset) return null → no selector.
 */
export function resolveReasoning(option: ModelOption | null | undefined): ResolvedReasoning | null {
	if (!option) return null;

	// `reasoning` is the explicit capability flag: non-reasoning models never show a
	// level selector, regardless of api preset.
	if (!option.reasoning) return null;

	// Explicit per-model levels win.
	if (option.reasoningLevels && option.reasoningLevels.length > 0) {
		const levels = option.reasoningLevels;
		const fallbackDefault = option.defaultReasoningLevel;
		return {
			levels,
			default: fallbackDefault && levels.includes(fallbackDefault) ? fallbackDefault : levels[0],
		};
	}

	// Reasoning-capable but no explicit levels → inherit the api-type preset.
	const preset = option.api ? getReasoningPreset(option.api) : undefined;
	if (!preset || preset.levels.length === 0) return null;
	return { levels: preset.levels, default: preset.default };
}
