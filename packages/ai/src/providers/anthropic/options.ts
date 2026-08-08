import type { SimpleStreamOptions, StreamOptions } from "../../types.js";

export type AnthropicEffort = "low" | "medium" | "high" | "max";

export interface AnthropicOptions extends StreamOptions {
	thinkingEnabled?: boolean;
	thinkingBudgetTokens?: number;
	effort?: AnthropicEffort;
	interleavedThinking?: boolean;
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
}

export function supportsAdaptiveThinking(modelId: string): boolean {
	return (
		modelId.includes("opus-4-6") ||
		modelId.includes("opus-4.6") ||
		modelId.includes("sonnet-4-6") ||
		modelId.includes("sonnet-4.6")
	);
}

export function mapThinkingLevelToEffort(level: SimpleStreamOptions["reasoning"], modelId: string): AnthropicEffort {
	switch (level) {
		case "minimal":
		case "low":
			return "low";
		case "medium":
			return "medium";
		case "high":
			return "high";
		case "xhigh":
			return modelId.includes("opus-4-6") || modelId.includes("opus-4.6") ? "max" : "high";
		default:
			return "high";
	}
}
