import type { StreamOptions } from "../../types.js";

export type GoogleThinkingLevel = "THINKING_LEVEL_UNSPECIFIED" | "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";

export interface GoogleGeminiCliOptions extends StreamOptions {
	toolChoice?: "auto" | "none" | "any";
	thinking?: {
		enabled: boolean;
		budgetTokens?: number;
		level?: GoogleThinkingLevel;
	};
	projectId?: string;
}
