import { describe, expect, it } from "vitest";
import { mapClaudeThinkingLevelToEffort, supportsClaudeAdaptiveThinking } from "../src/providers/claude-thinking.js";

describe("supportsClaudeAdaptiveThinking", () => {
	it.each([
		"claude-opus-4-6",
		"claude-sonnet-4-6",
		"claude-opus-4-7",
		"claude-opus-4-7-20260101",
		"claude-sonnet-4.7",
		"claude-opus-5",
		"claude-sonnet-5",
		"claude-haiku-5",
		"claude-fable-5-1",
		"anthropic/claude-opus-4.7",
		"global.anthropic.claude-opus-5-v1",
		"us.anthropic.claude-fable-5-1-v1:0",
		"claude-mythos-preview",
	])("uses adaptive thinking for %s", (id) => {
		expect(supportsClaudeAdaptiveThinking(id)).toBe(true);
	});

	it.each([
		"claude-sonnet-4-5",
		"claude-sonnet-4-5-20250929",
		"claude-haiku-4-5-20251001",
		"claude-opus-4-5",
		"claude-opus-4-1-20250805",
		"claude-opus-4-20250514",
		"claude-sonnet-4-20250514",
		"claude-sonnet-4",
		"anthropic/claude-opus-4.5",
		"global.anthropic.claude-sonnet-4-5-20250929-v1:0",
		"claude-3-7-sonnet-20250219",
		"claude-3-5-haiku-latest",
		"claude-sonnet-4-5-thinking",
		"kimi-k2",
		"future-model",
	])("keeps budget thinking for %s", (id) => {
		expect(supportsClaudeAdaptiveThinking(id)).toBe(false);
	});
});

describe("mapClaudeThinkingLevelToEffort", () => {
	it("maps xhigh to max on Opus 4.6 and later", () => {
		expect(mapClaudeThinkingLevelToEffort("xhigh", "claude-opus-4-6")).toBe("max");
		expect(mapClaudeThinkingLevelToEffort("xhigh", "claude-opus-4-7")).toBe("max");
		expect(mapClaudeThinkingLevelToEffort("xhigh", "claude-opus-5")).toBe("max");
		expect(mapClaudeThinkingLevelToEffort("xhigh", "claude-sonnet-4-6")).toBe("high");
		expect(mapClaudeThinkingLevelToEffort("xhigh", "claude-opus-4-5")).toBe("high");
	});
});
