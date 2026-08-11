import { getEnvApiKey } from "../../env-api-keys.js";
import type { Context, Model, SimpleStreamOptions, StreamFunction } from "../../types.js";
import { getGeminiThinkingLevel, getGoogleThinkingBudget, usesGeminiThinkingLevel } from "../google-stream/thinking.js";
import { projectLanguageModelAdapter } from "../legacy-adapter-stream.js";
import { buildBaseOptions, clampReasoning } from "../simple-options.js";
import { googleAdapter } from "./adapter.js";
import type { GoogleOptions } from "./options.js";

export const streamGoogle: StreamFunction<"google-generative-ai", GoogleOptions> = (model, context, options) =>
	projectLanguageModelAdapter(googleAdapter, model, context, options);

export const streamSimpleGoogle: StreamFunction<"google-generative-ai", SimpleStreamOptions> = (
	model: Model<"google-generative-ai">,
	context: Context,
	options?: SimpleStreamOptions,
) => {
	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
	if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
	const base = buildBaseOptions(model, options, apiKey);
	if (!options?.reasoning) {
		return streamGoogle(model, context, { ...base, thinking: { enabled: false } } satisfies GoogleOptions);
	}
	const effort = clampReasoning(options.reasoning)!;
	return streamGoogle(model, context, {
		...base,
		thinking: usesGeminiThinkingLevel(model.id)
			? { enabled: true, level: getGeminiThinkingLevel(model.id, effort) }
			: {
					enabled: true,
					budgetTokens: getGoogleThinkingBudget(model, effort, options.thinkingBudgets),
				},
	} satisfies GoogleOptions);
};
