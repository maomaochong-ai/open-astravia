import { describe, expect, it, vi } from "vitest";
import { streamOpenAICompletions } from "../src/providers/openai-completions.js";
import type { Model } from "../src/types.js";

const model: Model<"openai-completions"> = {
	id: "reasoner",
	name: "Reasoner",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 16_000,
};

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: async () => ({
					async *[Symbol.asyncIterator]() {
						yield { choices: [{ delta: { content: "hi" }, finish_reason: null }] };
						yield {
							choices: [{ delta: {}, finish_reason: "stop" }],
							usage: {
								prompt_tokens: 1_000,
								completion_tokens: 900,
								prompt_tokens_details: { cached_tokens: 200 },
								// 细分项：这 800 个 token 已经计入上面的 900。
								completion_tokens_details: { reasoning_tokens: 800 },
							},
						};
					},
				}),
			},
		};
	}
	return { default: FakeOpenAI };
});

describe("openai-completions usage accounting", () => {
	it("treats reasoning tokens as a breakdown of completion tokens, not an addition", async () => {
		const result = await streamOpenAICompletions(
			model,
			{ messages: [{ role: "user", content: "Hello", timestamp: Date.now() }] },
			{ apiKey: "test" },
		).result();

		expect(result.usage.output).toBe(900);
		expect(result.usage.input).toBe(800);
		expect(result.usage.cacheRead).toBe(200);
		expect(result.usage.totalTokens).toBe(1_900);
	});
});
