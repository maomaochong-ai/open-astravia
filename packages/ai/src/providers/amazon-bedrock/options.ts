import type { SimpleStreamOptions, StreamOptions, ThinkingBudgets, ThinkingLevel } from "../../types.js";

export interface BedrockOptions extends StreamOptions {
	region?: string;
	profile?: string;
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
	reasoning?: ThinkingLevel | (string & {});
	thinkingBudgets?: ThinkingBudgets;
	interleavedThinking?: boolean;
}

export function supportsAdaptiveThinking(modelId: string): boolean {
	return (
		modelId.includes("opus-4-6") ||
		modelId.includes("opus-4.6") ||
		modelId.includes("sonnet-4-6") ||
		modelId.includes("sonnet-4.6")
	);
}

export function mapThinkingLevelToEffort(
	level: SimpleStreamOptions["reasoning"],
	modelId: string,
): "low" | "medium" | "high" | "max" {
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
