import { getModelReasoningPreset } from "@vetta/ai/reasoning-presets";
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
	return option ? (getModelReasoningPreset(option) ?? null) : null;
}
