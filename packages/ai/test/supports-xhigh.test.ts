import { describe, expect, it } from "vitest";
import { supportsXhigh } from "../src/models.js";
import type { Api, Model } from "../src/types.js";

function model(id: string, api: Api = "anthropic-messages"): Model<Api> {
	return {
		id,
		api,
		name: id,
		provider: "test",
		baseUrl: "https://example.test",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
	};
}

describe("supportsXhigh", () => {
	it("returns true for Anthropic Opus 4.6 on anthropic-messages API", () => {
		expect(supportsXhigh(model("claude-opus-4-6"))).toBe(true);
	});

	it("returns false for non-Opus Anthropic models", () => {
		expect(supportsXhigh(model("claude-sonnet-4-5"))).toBe(false);
	});

	it("returns false for OpenRouter Opus 4.6 (openai-completions API)", () => {
		expect(supportsXhigh(model("anthropic/claude-opus-4.6", "openai-completions"))).toBe(false);
	});
	it("prefers model declarations over legacy name heuristics", () => {
		expect(supportsXhigh({ ...model("gpt-6", "openai-responses"), reasoningLevels: ["high", "xhigh"] })).toBe(true);
		expect(supportsXhigh({ ...model("gpt-5.2", "openai-responses"), reasoningLevels: ["low", "high"] })).toBe(false);
	});
});
