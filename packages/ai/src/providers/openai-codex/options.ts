import type { Tool as OpenAITool, ResponseInput } from "openai/resources/responses/responses.js";
import type { StreamOptions } from "../../types.js";

export interface OpenAICodexResponsesOptions extends StreamOptions {
	reasoningEffort?: string;
	reasoningSummary?: "auto" | "concise" | "detailed" | "off" | "on" | null;
	textVerbosity?: "low" | "medium" | "high";
}

export interface CodexRequestBody {
	model: string;
	store?: boolean;
	stream?: boolean;
	instructions?: string;
	input?: ResponseInput;
	tools?: OpenAITool[];
	tool_choice?: "auto";
	parallel_tool_calls?: boolean;
	temperature?: number;
	reasoning?: { effort?: string; summary?: string };
	text?: { verbosity?: string };
	include?: string[];
	prompt_cache_key?: string;
	[key: string]: unknown;
}
