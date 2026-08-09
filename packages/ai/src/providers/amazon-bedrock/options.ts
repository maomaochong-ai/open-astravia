import type { StreamOptions, ThinkingBudgets, ThinkingLevel } from "../../types.js";
import { mapClaudeThinkingLevelToEffort, supportsClaudeAdaptiveThinking } from "../claude-thinking.js";

export interface BedrockOptions extends StreamOptions {
	region?: string;
	profile?: string;
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
	reasoning?: ThinkingLevel | (string & {});
	thinkingBudgets?: ThinkingBudgets;
	interleavedThinking?: boolean;
}

export const supportsAdaptiveThinking = supportsClaudeAdaptiveThinking;
export const mapThinkingLevelToEffort = mapClaudeThinkingLevelToEffort;
