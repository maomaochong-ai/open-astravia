import type { Api, Model, SimpleStreamOptions, StreamOptions, ThinkingBudgets, ThinkingLevel } from "../types.js";

export function buildBaseOptions(model: Model<Api>, options?: SimpleStreamOptions, apiKey?: string): StreamOptions {
	return {
		temperature: options?.temperature,
		maxTokens: options?.maxTokens ?? model.maxTokens,
		signal: options?.signal,
		apiKey: apiKey || options?.apiKey,
		cacheRetention: options?.cacheRetention,
		sessionId: options?.sessionId,
		headers: options?.headers,
		onPayload: options?.onPayload,
		maxRetryDelayMs: options?.maxRetryDelayMs,
		metadata: options?.metadata,
		fetch: options?.fetch,
	};
}

export function clampReasoning(effort: string | undefined): Exclude<ThinkingLevel, "xhigh"> | undefined {
	// Accepts any string (reasoning is now a passthrough value) but only the token-budget
	// providers consume the result, and they always pass canonical ThinkingLevel values.
	return (effort === "xhigh" ? "high" : effort) as Exclude<ThinkingLevel, "xhigh"> | undefined;
}

export function adjustMaxTokensForThinking(
	baseMaxTokens: number | undefined,
	modelMaxTokens: number | undefined,
	reasoningLevel: string,
	customBudgets?: ThinkingBudgets,
): { maxTokens: number | undefined; thinkingBudget: number } {
	const defaultBudgets: ThinkingBudgets = {
		minimal: 1024,
		low: 2048,
		medium: 8192,
		high: 16384,
	};
	const budgets = { ...defaultBudgets, ...customBudgets };

	const minOutputTokens = 1024;
	const level = clampReasoning(reasoningLevel)!;
	// Fall back to the medium budget for any non-canonical level string.
	let thinkingBudget = budgets[level] ?? budgets.medium ?? 8192;
	if (baseMaxTokens === undefined) return { maxTokens: undefined, thinkingBudget };
	const requestedMaxTokens = baseMaxTokens + thinkingBudget;
	const maxTokens = modelMaxTokens === undefined ? requestedMaxTokens : Math.min(requestedMaxTokens, modelMaxTokens);

	if (maxTokens <= thinkingBudget) {
		thinkingBudget = Math.max(0, maxTokens - minOutputTokens);
	}

	return { maxTokens, thinkingBudget };
}
