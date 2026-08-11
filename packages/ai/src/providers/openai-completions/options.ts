import type { StreamOptions } from "../../types.js";

export interface OpenAICompletionsOptions extends StreamOptions {
	toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
	/** Raw reasoning effort passed through to the provider's reasoning field. */
	reasoningEffort?: string;
}
