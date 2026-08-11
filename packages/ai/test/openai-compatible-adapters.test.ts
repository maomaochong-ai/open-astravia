import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { streamQwen } from "../src/providers/qwen.js";
import { streamModel } from "../src/runtime/stream-model.js";
import {
	createControlledSseResponse,
	createProviderTestTransport,
	emptySseResponse,
	errorResponse,
	sseResponse,
} from "../src/testing/provider-test-transport.js";
import type { Api, AssistantMessage, Context, Model, ProviderStreamOptions } from "../src/types.js";

interface OpenAICompatibleFixture {
	readonly api: Api;
	readonly provider: string;
	readonly assertReasoningPayload: (payload: Record<string, unknown>) => void;
}

const context: Context = {
	systemPrompt: "Be concise.",
	messages: [{ role: "user", content: "Hello", timestamp: 1 }],
};

const toolContext: Context = {
	...context,
	tools: [
		{
			name: "lookup",
			description: "Look up a value",
			parameters: Type.Object({ query: Type.String() }),
		},
	],
};

const fixtures: readonly OpenAICompatibleFixture[] = [
	{
		api: "openai-completions",
		provider: "openai-compatible",
		assertReasoningPayload: (payload) => expect(payload.reasoning_effort).toBe("high"),
	},
	{
		api: "nvidia-openai-responses",
		provider: "nvidia",
		assertReasoningPayload: (payload) => {
			expect(payload.chat_template_kwargs).toEqual({ enable_thinking: true });
			expect(payload.reasoning_effort).toBeUndefined();
		},
	},
	{
		api: "qwen-openai-completions",
		provider: "qwen",
		assertReasoningPayload: (payload) => {
			expect(payload.enable_thinking).toBe(true);
			expect(payload.chat_template_kwargs).toEqual({ enable_thinking: true });
			expect(payload.reasoning_effort).toBe("high");
		},
	},
	{
		api: "openai-completions-deepseek",
		provider: "deepseek",
		assertReasoningPayload: (payload) => {
			expect(payload.thinking).toEqual({ type: "enabled", reasoning_effort: "high" });
			expect(payload.reasoning_effort).toBeUndefined();
		},
	},
	{
		api: "zai-openai-completions",
		provider: "zai",
		assertReasoningPayload: (payload) => {
			expect(payload.thinking).toEqual({ type: "enabled" });
			expect(payload.reasoning_effort).toBe("high");
		},
	},
	{
		api: "zhipu-openai-completions",
		provider: "zhipu",
		assertReasoningPayload: (payload) => {
			expect(payload.thinking).toEqual({ type: "enabled" });
			expect(payload.reasoning_effort).toBe("high");
		},
	},
];

describe("OpenAI-compatible native adapters", () => {
	for (const fixture of fixtures) {
		it(`streams ${fixture.api} through the default adapter registry`, async () => {
			const transport = createProviderTestTransport([textResponse()]);
			const response = await streamModel({
				model: model(fixture),
				context,
				options: adapterOptions(transport.fetch),
			});
			const eventTypes: string[] = [];

			for await (const event of response.events) eventTypes.push(event.type);
			const result = await response.result;

			expect(textOf(result)).toBe("hello");
			expect(result.api).toBe("openai-completions");
			expect(result.usage).toMatchObject({ input: 3, output: 2, totalTokens: 5 });
			expect(eventTypes).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);
			expect(transport.requests).toHaveLength(1);
			fixture.assertReasoningPayload(JSON.parse(transport.requests[0]?.body ?? "{}"));
		});

		it(`preserves tool-call semantics for ${fixture.api}`, async () => {
			const transport = createProviderTestTransport([toolResponse()]);
			const response = await streamModel({
				model: model(fixture),
				context: toolContext,
				options: adapterOptions(transport.fetch),
			});
			const eventTypes: string[] = [];

			for await (const event of response.events) eventTypes.push(event.type);
			const result = await response.result;
			const toolCall = result.content.find((block) => block.type === "toolCall");

			expect(toolCall).toMatchObject({ id: "call-1", name: "lookup", arguments: { query: "test" } });
			expect(result.stopReason).toBe("toolUse");
			expect(eventTypes).toContain("toolcall_delta");
			expect(eventTypes).toContain("toolcall_end");
			expect(JSON.parse(transport.requests[0]?.body ?? "{}")).toMatchObject({
				tools: [expect.objectContaining({ function: expect.objectContaining({ name: "lookup" }) })],
			});
		});
	}

	it("rejects malformed wire data without a compatibility error event", async () => {
		const fixture = fixtureFor("qwen-openai-completions");
		const transport = createProviderTestTransport([openAISse([{ choices: "invalid" }])]);
		const response = await streamModel({
			model: model(fixture),
			context,
			options: adapterOptions(transport.fetch),
		});

		await expect(consume(response.events)).rejects.toMatchObject({ code: "AI_RESPONSE_VALIDATION_FAILED" });
		await expect(response.result).rejects.toMatchObject({ code: "AI_RESPONSE_VALIDATION_FAILED" });
	});

	it("normalizes rate limits on the native adapter boundary", async () => {
		const fixture = fixtureFor("openai-completions-deepseek");
		const rateLimitResponse = () =>
			errorResponse(
				429,
				{ error: { type: "rate_limit_error", message: "too many requests" } },
				{
					headers: { "retry-after": "0" },
				},
			);
		const transport = createProviderTestTransport([rateLimitResponse(), rateLimitResponse(), rateLimitResponse()]);
		const response = await streamModel({
			model: model(fixture),
			context,
			options: adapterOptions(transport.fetch),
		});

		await expect(response.result).rejects.toMatchObject({
			code: "AI_RATE_LIMITED",
			retryable: true,
			statusCode: 429,
		});
		expect(transport.requests).toHaveLength(3);
	});

	it("settles an already aborted native adapter request", async () => {
		const fixture = fixtureFor("zai-openai-completions");
		const controller = new AbortController();
		controller.abort("test abort");
		const transport = createProviderTestTransport([textResponse()]);
		const response = await streamModel({
			model: model(fixture),
			context,
			options: { ...adapterOptions(transport.fetch), signal: controller.signal },
		});

		await expect(response.result).rejects.toMatchObject({ code: "AI_ABORTED" });
	});

	it("rejects an empty provider stream as a protocol failure", async () => {
		const fixture = fixtureFor("nvidia-openai-responses");
		const transport = createProviderTestTransport([emptySseResponse()]);
		const response = await streamModel({
			model: model(fixture),
			context,
			options: adapterOptions(transport.fetch),
		});

		await expect(response.result).rejects.toMatchObject({
			code: "AI_STREAM_PROTOCOL_FAILED",
			message: "Stream ended without provider events",
		});
	});

	it("propagates abort after a provider stream has started", async () => {
		const fixture = fixtureFor("zhipu-openai-completions");
		const controlled = createControlledSseResponse();
		const transport = createProviderTestTransport([
			(request) => {
				request.signal.addEventListener(
					"abort",
					() => controlled.fail(new DOMException("The operation was aborted", "AbortError")),
					{ once: true },
				);
				return controlled.response;
			},
		]);
		const controller = new AbortController();
		const response = await streamModel({
			model: model(fixture),
			context,
			options: { ...adapterOptions(transport.fetch), signal: controller.signal },
		});
		controlled.emit({ data: openAIChunk({ role: "assistant", content: "partial" }) });

		controller.abort("test abort");

		await expect(response.result).rejects.toMatchObject({ code: "AI_ABORTED" });
	});

	it("keeps the legacy stream API as an explicit error-event projection", async () => {
		const fixture = fixtureFor("qwen-openai-completions");
		const transport = createProviderTestTransport([openAISse([{ choices: "invalid" }])]);
		const stream = streamQwen(model(fixture) as Model<"qwen-openai-completions">, context, {
			...adapterOptions(transport.fetch),
		});
		const events = [];

		for await (const event of stream) events.push(event);
		const result = await stream.result();

		expect(events.at(-1)?.type).toBe("error");
		expect(result).toMatchObject({ stopReason: "error", errorMessage: expect.stringContaining("validation failed") });
	});
});

function fixtureFor(api: Api): OpenAICompatibleFixture {
	const fixture = fixtures.find((candidate) => candidate.api === api);
	if (!fixture) throw new Error(`Missing fixture for ${api}`);
	return fixture;
}

function model(fixture: OpenAICompatibleFixture): Model<Api> {
	return {
		id: "test-model",
		name: "Test Model",
		api: fixture.api,
		provider: fixture.provider,
		baseUrl: "https://provider.test/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000,
		maxTokens: 100,
	};
}

function adapterOptions(fetch: typeof globalThis.fetch): ProviderStreamOptions {
	return { apiKey: "test", fetch, reasoningEffort: "high" };
}

function textResponse(): Response {
	return openAISse([
		openAIChunk({ role: "assistant", content: "hello" }),
		openAIChunk({}, "stop"),
		{
			id: "chunk-usage",
			object: "chat.completion.chunk",
			created: 1,
			model: "test-model",
			choices: [],
			usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
		},
	]);
}

function toolResponse(): Response {
	return openAISse([
		openAIChunk({
			role: "assistant",
			tool_calls: [
				{
					index: 0,
					id: "call-1",
					type: "function",
					function: { name: "lookup", arguments: '{"query":' },
				},
			],
		}),
		openAIChunk({ tool_calls: [{ index: 0, function: { arguments: '"test"}' } }] }, "tool_calls"),
	]);
}

function openAISse(chunks: readonly unknown[]): Response {
	return sseResponse([...chunks.map((data) => ({ data })), { data: "[DONE]" }]);
}

function openAIChunk(delta: Record<string, unknown>, finishReason: string | null = null): unknown {
	return {
		id: "chunk-1",
		object: "chat.completion.chunk",
		created: 1,
		model: "test-model",
		choices: [{ index: 0, delta, finish_reason: finishReason }],
	};
}

function textOf(message: AssistantMessage): string {
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

async function consume(events: AsyncIterable<unknown>): Promise<void> {
	for await (const _event of events) {
		// Drain the stream to observe its terminal contract.
	}
}
