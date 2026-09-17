import { describe, expect, it, vi } from "vitest";
import { streamSimpleAzureOpenAIResponses } from "../src/providers/azure-openai-responses.js";
import { streamSimpleOpenAICodexResponses } from "../src/providers/openai-codex-responses.js";
import type { Model } from "../src/types.js";

describe("Responses variant effort values", () => {
	it.each(["azure", "codex"])("preserves xhigh through the %s simple stream API", async (provider) => {
		const model: Model<"openai-codex-responses"> = {
			id: "gpt-6",
			name: "gpt-6",
			api: "openai-codex-responses",
			provider: "test",
			baseUrl: "https://example.test/v1",
			reasoning: true,
			reasoningLevels: ["high", "xhigh"],
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
		};
		const requests: unknown[] = [];
		const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
			requests.push(JSON.parse(String(init?.body)));
			return new Response(
				`data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [], usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } } })}\n\n`,
				{ headers: { "content-type": "text/event-stream" } },
			);
		});
		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } }),
		).toString("base64url");
		const options = { apiKey: `test.${payload}.test`, reasoning: "xhigh", fetch, maxRetries: 0 };
		const stream =
			provider === "codex"
				? streamSimpleOpenAICodexResponses(model, { messages: [] }, options)
				: streamSimpleAzureOpenAIResponses({ ...model, api: "azure-openai-responses" }, { messages: [] }, options);
		expect((await stream.result()).stopReason).toBe("stop");
		expect(requests).toEqual([expect.objectContaining({ reasoning: { effort: "xhigh", summary: "auto" } })]);
	});
});
