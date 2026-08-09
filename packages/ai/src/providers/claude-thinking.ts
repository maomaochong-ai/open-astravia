import type { SimpleStreamOptions } from "../types.js";

export type ClaudeEffort = "low" | "medium" | "high" | "max";

export function supportsClaudeAdaptiveThinking(modelId: string): boolean {
	return (
		modelId.includes("opus-4-6") ||
		modelId.includes("opus-4.6") ||
		modelId.includes("sonnet-4-6") ||
		modelId.includes("sonnet-4.6")
	);
}

export function mapClaudeThinkingLevelToEffort(level: SimpleStreamOptions["reasoning"], modelId: string): ClaudeEffort {
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
