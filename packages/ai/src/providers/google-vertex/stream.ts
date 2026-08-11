import type { Context, Model, SimpleStreamOptions, StreamFunction } from "../../types.js";
import { getGeminiThinkingLevel, getGoogleThinkingBudget, usesGeminiThinkingLevel } from "../google-stream/thinking.js";
import { projectLanguageModelAdapter } from "../legacy-adapter-stream.js";
import { buildBaseOptions, clampReasoning } from "../simple-options.js";
import { googleVertexAdapter } from "./adapter.js";
import type { GoogleVertexOptions } from "./options.js";

export const streamGoogleVertex: StreamFunction<"google-vertex", GoogleVertexOptions> = (model, context, options) =>
	projectLanguageModelAdapter(googleVertexAdapter, model, context, options);

export const streamSimpleGoogleVertex: StreamFunction<"google-vertex", SimpleStreamOptions> = (
	model: Model<"google-vertex">,
	context: Context,
	options?: SimpleStreamOptions,
) => {
	const base = buildBaseOptions(model, options, undefined);
	if (!options?.reasoning) {
		return streamGoogleVertex(model, context, {
			...base,
			thinking: { enabled: false },
		} satisfies GoogleVertexOptions);
	}
	const effort = clampReasoning(options.reasoning)!;
	return streamGoogleVertex(model, context, {
		...base,
		thinking: usesGeminiThinkingLevel(model.id)
			? { enabled: true, level: getGeminiThinkingLevel(model.id, effort) }
			: {
					enabled: true,
					budgetTokens: getGoogleThinkingBudget(model, effort, options.thinkingBudgets),
				},
	} satisfies GoogleVertexOptions);
};
