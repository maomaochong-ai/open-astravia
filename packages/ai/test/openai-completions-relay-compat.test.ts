import { describe, expect, it } from "vitest";
import { streamModel } from "../src/runtime/stream-model.js";
import { createProviderTestTransport, sseResponse } from "../src/testing/provider-test-transport.js";
import type { AssistantMessage, Context, Model, ProviderStreamOptions } from "../src/types.js";

/**
 * Wire shapes captured from an OpenAI-compatible relay fronting Hunyuan (`hy3`) and Kimi
 * (`kimi-k2.7`). Both emit `finish_reason: ""` on every non-terminal chunk, which used to fail
 * chunk validation on the very first event and surface as an empty assistant message.
 */
const context: Context = {
	systemPrompt: "Be concise.",
	messages: [{ role: "user", content: "hi", timestamp: 1 }],
};

describe("openai-completions relay compatibility", () => {
	it("streams a relay that sends an empty-string finish_reason on every non-terminal chunk", async () => {
		const transport = createProviderTestTransport([
			relaySse([
				relayChunk({ content: "", role: "assistant" }, ""),
				relayChunk({ content: "", reasoning_content: "The" }, ""),
				relayChunk({ content: "", reasoning_content: " user said hi" }, ""),
				relayChunk({ content: "Hi! How can I" }, ""),
				relayChunk({ content: " help you today", role: "assistant" }, ""),
				{
					...relayChunk({ content: "?", role: "assistant" }, "stop"),
					usage: { prompt_tokens: 13, completion_tokens: 35, total_tokens: 48 },
				},
			]),
		]);

		const response = await streamModel({
			model: relayModel(),
			context,
			options: relayOptions(transport.fetch),
		});
		const eventTypes: string[] = [];
		for await (const event of response.events) eventTypes.push(event.type);
		const result = await response.result;

		expect(textOf(result)).toBe("Hi! How can I help you today?");
		expect(thinkingOf(result)).toBe("The user said hi");
		expect(result.stopReason).toBe("stop");
		expect(result.usage).toMatchObject({ input: 13, output: 35 });
		expect(eventTypes).not.toContain("error");
	});

	it("accepts choices without index or delta", async () => {
		const transport = createProviderTestTransport([
			relaySse([
				{ choices: [{ delta: { role: "assistant", content: "ok" } }] },
				{ choices: [{ index: 0, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
			]),
		]);

		const response = await streamModel({
			model: relayModel(),
			context,
			options: relayOptions(transport.fetch),
		});
		const result = await response.result;

		expect(textOf(result)).toBe("ok");
		expect(result.stopReason).toBe("stop");
	});

	it("folds a vendor finish_reason outside the OpenAI enum into a normal stop", async () => {
		const transport = createProviderTestTransport([
			relaySse([relayChunk({ role: "assistant", content: "done" }, null), relayChunk({}, "eos")]),
		]);

		const response = await streamModel({
			model: relayModel(),
			context,
			options: relayOptions(transport.fetch),
		});
		const result = await response.result;

		expect(textOf(result)).toBe("done");
		expect(result.stopReason).toBe("stop");
	});

	it("still rejects a structurally invalid chunk and reports the offending value", async () => {
		const transport = createProviderTestTransport([relaySse([{ choices: "invalid" }])]);

		const response = await streamModel({
			model: relayModel(),
			context,
			options: relayOptions(transport.fetch),
		});

		await expect(response.result).rejects.toMatchObject({
			code: "AI_RESPONSE_VALIDATION_FAILED",
			metadata: {
				errors: [expect.objectContaining({ path: "/choices", received: '"invalid"' })],
			},
		});
	});
});

function relayModel(): Model<"openai-completions"> {
	return {
		id: "hy3",
		name: "hy3",
		api: "openai-completions",
		provider: "openai-compatible",
		baseUrl: "https://relay.test/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000,
		maxTokens: 100,
	};
}

function relayOptions(fetch: typeof globalThis.fetch): ProviderStreamOptions {
	return { apiKey: "test", fetch };
}

function relaySse(chunks: readonly unknown[]): Response {
	return sseResponse([...chunks.map((data) => ({ data })), { data: "[DONE]" }]);
}

function relayChunk(delta: Record<string, unknown>, finishReason: string | null): Record<string, unknown> {
	return {
		id: "be6bca30f1fd464fa748a79c88c52def",
		object: "chat.completion.chunk",
		created: 1786529576,
		model: "hy3",
		choices: [{ delta, finish_reason: finishReason, index: 0, logprobs: null }],
		usage: null,
	};
}

function textOf(message: AssistantMessage): string {
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function thinkingOf(message: AssistantMessage): string {
	return message.content
		.filter((block) => block.type === "thinking")
		.map((block) => block.thinking)
		.join("");
}
