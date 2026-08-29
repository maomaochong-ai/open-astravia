import { describe, expect, it } from "vitest";
import { buildOpenAICompletionsParams } from "../src/providers/openai-completions/request.js";
import { buildBaseOptions } from "../src/providers/simple-options.js";
import type { Context, Model } from "../src/types.js";

function model(maxTokens: number | undefined): Model<"openai-completions"> {
	return {
		id: "test-model",
		name: "Test model",
		api: "openai-completions",
		provider: "test",
		baseUrl: "https://example.invalid/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens,
	};
}

const context: Context = {
	systemPrompt: "",
	messages: [{ role: "user", content: "Hello", timestamp: 1 }],
};

describe("output token limit resolution", () => {
	it("uses the known model limit without a global 32K ceiling", () => {
		expect(buildBaseOptions(model(131_072)).maxTokens).toBe(131_072);
	});

	it("leaves the request limit unset when the model limit is unknown", () => {
		expect(buildBaseOptions(model(undefined)).maxTokens).toBeUndefined();
	});

	it("preserves an explicit per-call limit", () => {
		expect(buildBaseOptions(model(16_384), { maxTokens: 98_304 }).maxTokens).toBe(98_304);
	});

	it("omits OpenAI-compatible output limit fields when the limit is unknown", () => {
		const params = buildOpenAICompletionsParams(model(undefined), context);

		expect(params).not.toHaveProperty("max_tokens");
		expect(params).not.toHaveProperty("max_completion_tokens");
	});
});
