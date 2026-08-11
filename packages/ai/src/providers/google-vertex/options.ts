import type { GoogleGenerationOptions } from "../google-stream/request.js";
import type { GoogleThinkingLevel } from "../google-stream/thinking.js";

export interface GoogleVertexOptions extends GoogleGenerationOptions {
	thinking?: {
		enabled: boolean;
		budgetTokens?: number;
		level?: GoogleThinkingLevel;
	};
	project?: string;
	location?: string;
}
