import type { StreamOptions } from "../../types.js";
import {
	type ClaudeEffort,
	mapClaudeThinkingLevelToEffort,
	supportsClaudeAdaptiveThinking,
} from "../claude-thinking.js";

export type AnthropicEffort = ClaudeEffort;

export interface AnthropicOptions extends StreamOptions {
	thinkingEnabled?: boolean;
	thinkingBudgetTokens?: number;
	effort?: AnthropicEffort;
	interleavedThinking?: boolean;
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
}

export const supportsAdaptiveThinking = supportsClaudeAdaptiveThinking;
export const mapThinkingLevelToEffort = mapClaudeThinkingLevelToEffort;
