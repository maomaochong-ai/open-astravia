import type { Context, Model, SimpleStreamOptions, StreamFunction } from "../../types.js";
import { projectLanguageModelAdapter } from "../legacy-adapter-stream.js";
import { adjustMaxTokensForThinking, buildBaseOptions, clampReasoning } from "../simple-options.js";
import { bedrockAdapter } from "./adapter.js";
import type { BedrockOptions } from "./options.js";
import { supportsAdaptiveThinking } from "./options.js";

export const streamBedrock: StreamFunction<"bedrock-converse-stream", BedrockOptions> = (
	model: Model<"bedrock-converse-stream">,
	context: Context,
	options: BedrockOptions = {},
) => projectLanguageModelAdapter(bedrockAdapter, model, context, options);

export const streamSimpleBedrock: StreamFunction<"bedrock-converse-stream", SimpleStreamOptions> = (
	model: Model<"bedrock-converse-stream">,
	context: Context,
	options?: SimpleStreamOptions,
) => {
	const base = buildBaseOptions(model, options, undefined);
	if (!options?.reasoning) {
		return streamBedrock(model, context, { ...base, reasoning: undefined } satisfies BedrockOptions);
	}
	if (model.id.includes("anthropic.claude") || model.id.includes("anthropic/claude")) {
		if (supportsAdaptiveThinking(model.id)) {
			return streamBedrock(model, context, {
				...base,
				reasoning: options.reasoning,
				thinkingBudgets: options.thinkingBudgets,
			} satisfies BedrockOptions);
		}
		const adjusted = adjustMaxTokensForThinking(
			base.maxTokens || 0,
			model.maxTokens,
			options.reasoning,
			options.thinkingBudgets,
		);
		return streamBedrock(model, context, {
			...base,
			maxTokens: adjusted.maxTokens,
			reasoning: options.reasoning,
			thinkingBudgets: {
				...(options.thinkingBudgets || {}),
				[clampReasoning(options.reasoning)!]: adjusted.thinkingBudget,
			},
		} satisfies BedrockOptions);
	}
	return streamBedrock(model, context, {
		...base,
		reasoning: options.reasoning,
		thinkingBudgets: options.thinkingBudgets,
	} satisfies BedrockOptions);
};
