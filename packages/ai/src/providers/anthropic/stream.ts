import { getEnvApiKey } from "../../env-api-keys.js";
import type { Context, Model, SimpleStreamOptions, StreamFunction } from "../../types.js";
import { projectLanguageModelAdapter } from "../legacy-adapter-stream.js";
import { adjustMaxTokensForThinking, buildBaseOptions } from "../simple-options.js";
import { anthropicAdapter } from "./adapter.js";
import type { AnthropicOptions } from "./options.js";
import { mapThinkingLevelToEffort, supportsAdaptiveThinking } from "./options.js";

export const streamAnthropic: StreamFunction<"anthropic-messages", AnthropicOptions> = (
	model: Model<"anthropic-messages">,
	context: Context,
	options?: AnthropicOptions,
) => projectLanguageModelAdapter(anthropicAdapter, model, context, options);

export const streamSimpleAnthropic: StreamFunction<"anthropic-messages", SimpleStreamOptions> = (
	model: Model<"anthropic-messages">,
	context: Context,
	options?: SimpleStreamOptions,
) => {
	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
	if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
	const base = buildBaseOptions(model, options, apiKey);
	if (!options?.reasoning) {
		return streamAnthropic(model, context, { ...base, thinkingEnabled: false } satisfies AnthropicOptions);
	}
	if (supportsAdaptiveThinking(model.id)) {
		return streamAnthropic(model, context, {
			...base,
			thinkingEnabled: true,
			effort: mapThinkingLevelToEffort(options.reasoning, model.id),
		} satisfies AnthropicOptions);
	}
	const adjusted = adjustMaxTokensForThinking(
		base.maxTokens || 0,
		model.maxTokens,
		options.reasoning,
		options.thinkingBudgets,
	);
	return streamAnthropic(model, context, {
		...base,
		maxTokens: adjusted.maxTokens,
		thinkingEnabled: true,
		thinkingBudgetTokens: adjusted.thinkingBudget,
	} satisfies AnthropicOptions);
};
