import type { Context, Model, SimpleStreamOptions, StreamFunction, ThinkingBudgets } from "../../types.js";
import { getGeminiThinkingLevel, usesGeminiThinkingLevel } from "../google-stream/thinking.js";
import { projectLanguageModelAdapter } from "../legacy-adapter-stream.js";
import { buildBaseOptions, clampReasoning } from "../simple-options.js";
import { googleGeminiCliAdapter } from "./adapter.js";
import type { GoogleGeminiCliOptions } from "./options.js";

export const streamGoogleGeminiCli: StreamFunction<"google-gemini-cli", GoogleGeminiCliOptions> = (
	model,
	context,
	options,
) => projectLanguageModelAdapter(googleGeminiCliAdapter, model, context, options);

export const streamSimpleGoogleGeminiCli: StreamFunction<"google-gemini-cli", SimpleStreamOptions> = (
	model: Model<"google-gemini-cli">,
	context: Context,
	options?: SimpleStreamOptions,
) => {
	const apiKey = options?.apiKey;
	if (!apiKey) throw new Error("Google Cloud Code Assist requires OAuth authentication. Use /login to authenticate.");
	const base = buildBaseOptions(model, options, apiKey);
	if (!options?.reasoning) {
		return streamGoogleGeminiCli(model, context, {
			...base,
			thinking: { enabled: false },
		} satisfies GoogleGeminiCliOptions);
	}
	const effort = clampReasoning(options.reasoning)!;
	if (usesGeminiThinkingLevel(model.id)) {
		return streamGoogleGeminiCli(model, context, {
			...base,
			thinking: { enabled: true, level: getGeminiThinkingLevel(model.id, effort) },
		} satisfies GoogleGeminiCliOptions);
	}
	const defaultBudgets: ThinkingBudgets = { minimal: 1024, low: 2048, medium: 8192, high: 16384 };
	const budgets = { ...defaultBudgets, ...options.thinkingBudgets };
	const minimumOutputTokens = 1024;
	let thinkingBudget = budgets[effort]!;
	const maxTokens = Math.min((base.maxTokens || 0) + thinkingBudget, model.maxTokens);
	if (maxTokens <= thinkingBudget) thinkingBudget = Math.max(0, maxTokens - minimumOutputTokens);
	return streamGoogleGeminiCli(model, context, {
		...base,
		maxTokens,
		thinking: { enabled: true, budgetTokens: thinkingBudget },
	} satisfies GoogleGeminiCliOptions);
};
