import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import type { StreamOptions } from "../../types.js";

export interface OpenAIResponsesOptions extends StreamOptions {
	/** Raw reasoning effort passed through to reasoning.effort. */
	reasoningEffort?: string;
	reasoningSummary?: "auto" | "detailed" | "concise" | null;
	serviceTier?: ResponseCreateParamsStreaming["service_tier"];
}
