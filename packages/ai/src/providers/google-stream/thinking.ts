import type { Api, Model, ThinkingBudgets, ThinkingLevel } from "../../types.js";

export type GoogleThinkingLevel = "THINKING_LEVEL_UNSPECIFIED" | "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
export type ClampedThinkingLevel = Exclude<ThinkingLevel, "xhigh">;

export function getGeminiThinkingLevel(modelId: string, effort: ClampedThinkingLevel): GoogleThinkingLevel {
	if (modelId.includes("3-pro")) {
		return effort === "minimal" || effort === "low" ? "LOW" : "HIGH";
	}
	return effort.toUpperCase() as Exclude<GoogleThinkingLevel, "THINKING_LEVEL_UNSPECIFIED">;
}

export function getGoogleThinkingBudget<TApi extends Api>(
	model: Model<TApi>,
	effort: ClampedThinkingLevel,
	customBudgets?: ThinkingBudgets,
): number {
	if (customBudgets?.[effort] !== undefined) return customBudgets[effort];
	if (model.id.includes("2.5-pro")) {
		return { minimal: 128, low: 2048, medium: 8192, high: 32768 }[effort];
	}
	if (model.id.includes("2.5-flash")) {
		return { minimal: 128, low: 2048, medium: 8192, high: 24576 }[effort];
	}
	return -1;
}

export function usesGeminiThinkingLevel(modelId: string): boolean {
	return modelId.includes("3-pro") || modelId.includes("3-flash");
}
