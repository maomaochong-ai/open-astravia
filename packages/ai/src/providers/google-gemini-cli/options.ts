import type { StreamOptions } from "../../types.js";
import type { GoogleThinkingLevel } from "../google-stream/thinking.js";

export type { GoogleThinkingLevel } from "../google-stream/thinking.js";

export interface GoogleGeminiCliOptions extends StreamOptions {
	toolChoice?: "auto" | "none" | "any";
	thinking?: {
		enabled: boolean;
		budgetTokens?: number;
		level?: GoogleThinkingLevel;
	};
	projectId?: string;
}
