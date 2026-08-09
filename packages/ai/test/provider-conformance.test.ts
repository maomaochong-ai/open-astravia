import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { streamAnthropic } from "../src/providers/anthropic/stream.js";
import { streamOpenAICompletions } from "../src/providers/openai-completions/stream.js";
import {
	createProviderTestTransport,
	emptySseResponse,
	errorResponse,
	type SseRecord,
	sseResponse,
} from "../src/testing/provider-test-transport.js";
import type { Api, AssistantMessage, AssistantMessageEvent, Context, FetchFunction, Model } from "../src/types.js";
import type { AssistantMessageEventStream } from "../src/utils/event-stream.js";
import { isContextOverflow } from "../src/utils/overflow.js";

interface ProviderConformanceFixture {
	readonly name: string;
	createTextResponse(): Response;
	createToolResponse(): Response;
	createErrorResponse(): Response;
	createOverflowResponse(): Response;
	createMalformedResponse(): Response;
	stream(fetch: FetchFunction, signal?: AbortSignal): AssistantMessageEventStream;
}

const context: Context = {
	systemPrompt: "Be concise.",
	messages: [{ role: "user" as const, content: "Hello", timestamp: 1 }],
	tools: [
		{
			name: "lookup",
			description: "Look up a value",
			parameters: Type.Object({ query: Type.String() }),
		},
	],
};

const openAIModel: Model<"openai-completions"> = createModel("openai-completions", "openai");
const anthropicModel: Model<"anthropic-messages"> = createModel("anthropic-messages", "anthropic");

const fixtures: ProviderConformanceFixture[] = [
	{
		name: "OpenAI Completions",
		createTextResponse: () =>
			openAISse([openAIChunk({ role: "assistant", content: "hello" }), openAIChunk({}, "stop"), openAIUsageChunk()]),
		createToolResponse: () =>
			openAISse([
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
				openAIUsageChunk(),
			]),
		createErrorResponse: () =>
			errorResponse(400, { error: { type: "invalid_request_error", message: "bad request" } }),
		createOverflowResponse: () =>
			errorResponse(400, {
				error: { type: "invalid_request_error", message: "Your input exceeds the context window of this model" },
			}),
		createMalformedResponse: () => openAISse([{ choices: "invalid" }]),
		stream: (fetch, signal) => streamOpenAICompletions(openAIModel, context, { apiKey: "test", fetch, signal }),
	},
	{
		name: "Anthropic Messages",
		createTextResponse: () =>
			anthropicSse([
				anthropicMessageStart(),
				{
					event: "content_block_start",
					data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
				},
				{
					event: "content_block_delta",
					data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
				},
				{ event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
				anthropicMessageDelta("end_turn"),
				{ event: "message_stop", data: { type: "message_stop" } },
			]),
		createToolResponse: () =>
			anthropicSse([
				anthropicMessageStart(),
				{
					event: "content_block_start",
					data: {
						type: "content_block_start",
						index: 0,
						content_block: { type: "tool_use", id: "call-1", name: "lookup", input: {} },
					},
				},
				{
					event: "content_block_delta",
					data: {
						type: "content_block_delta",
						index: 0,
						delta: { type: "input_json_delta", partial_json: '{"query":"test"}' },
					},
				},
				{ event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
				anthropicMessageDelta("tool_use"),
				{ event: "message_stop", data: { type: "message_stop" } },
			]),
		createErrorResponse: () =>
			errorResponse(400, { type: "error", error: { type: "invalid_request_error", message: "bad request" } }),
		createOverflowResponse: () =>
			errorResponse(400, {
				type: "error",
				error: { type: "invalid_request_error", message: "prompt is too long: 1200 tokens > 1000 maximum" },
			}),
		createMalformedResponse: () =>
			anthropicSse([
				anthropicMessageStart(),
				{
					event: "content_block_start",
					data: {
						type: "content_block_start",
						index: "zero",
						content_block: { type: "text", text: "" },
					},
				},
			]),
		stream: (fetch, signal) => streamAnthropic(anthropicModel, context, { apiKey: "test", fetch, signal }),
	},
];

for (const fixture of fixtures) providerConformanceSuite(fixture);

function providerConformanceSuite(fixture: ProviderConformanceFixture): void {
	describe(`${fixture.name} provider conformance`, () => {
		it("streams text, usage, lifecycle, and a successful terminal result", async () => {
			const transport = createProviderTestTransport([fixture.createTextResponse()]);
			const { events, result } = await collect(fixture.stream(transport.fetch));

			expect(textOf(result)).toBe("hello");
			expect(result.stopReason).toBe("stop");
			expect(result.usage).toMatchObject({ input: 3, output: 2, totalTokens: 5 });
			expect(events.map((event) => event.type)).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);
			expect(transport.requests).toHaveLength(1);
			expect(JSON.parse(transport.requests[0]?.body ?? "{}")).toMatchObject({ stream: true });
		});

		it("streams tool arguments and returns toolUse", async () => {
			const transport = createProviderTestTransport([fixture.createToolResponse()]);
			const { events, result } = await collect(fixture.stream(transport.fetch));
			const toolCall = result.content.find((block) => block.type === "toolCall");

			expect(toolCall).toMatchObject({ id: "call-1", name: "lookup", arguments: { query: "test" } });
			expect(result.stopReason).toBe("toolUse");
			expect(events.map((event) => event.type)).toContain("toolcall_delta");
			expect(events.map((event) => event.type)).toContain("toolcall_end");
		});

		it("converts an HTTP error into the compatibility error terminal", async () => {
			const transport = createProviderTestTransport([fixture.createErrorResponse()]);
			const { events, result } = await collect(fixture.stream(transport.fetch));

			expect(result.stopReason).toBe("error");
			expect(result.errorMessage).toContain("bad request");
			expect(events.at(-1)?.type).toBe("error");
		});

		it("preserves context overflow classification", async () => {
			const transport = createProviderTestTransport([fixture.createOverflowResponse()]);
			const { result } = await collect(fixture.stream(transport.fetch));

			expect(result.stopReason).toBe("error");
			expect(isContextOverflow(result, 1000)).toBe(true);
		});

		it("rejects a malformed wire event through TypeBox validation", async () => {
			const transport = createProviderTestTransport([fixture.createMalformedResponse()]);
			const { events, result } = await collect(fixture.stream(transport.fetch));

			expect(result.stopReason).toBe("error");
			expect(result.errorMessage).toContain("response validation failed");
			expect(events.at(-1)?.type).toBe("error");
		});

		it("rejects an empty successful SSE response", async () => {
			const transport = createProviderTestTransport([emptySseResponse()]);
			const { events, result } = await collect(fixture.stream(transport.fetch));

			expect(result.stopReason).toBe("error");
			expect(result.errorMessage).toContain("without provider events");
			expect(events.at(-1)?.type).toBe("error");
		});

		it("settles an already aborted request", async () => {
			const controller = new AbortController();
			controller.abort();
			const transport = createProviderTestTransport([fixture.createTextResponse()]);
			const { events, result } = await collect(fixture.stream(transport.fetch, controller.signal));

			expect(result.stopReason).toBe("aborted");
			expect(events.at(-1)?.type).toBe("error");
		});
	});
}

async function collect(stream: AssistantMessageEventStream): Promise<{
	events: AssistantMessageEvent[];
	result: AssistantMessage;
}> {
	const events: AssistantMessageEvent[] = [];
	for await (const event of stream) events.push(event);
	return { events, result: await stream.result() };
}

function textOf(message: AssistantMessage): string {
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function createModel<TApi extends Api>(api: TApi, provider: string): Model<TApi> {
	return {
		id: "test-model",
		name: "Test Model",
		api,
		provider,
		baseUrl: "https://provider.test/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};
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

function openAIUsageChunk(): unknown {
	return {
		id: "chunk-usage",
		object: "chat.completion.chunk",
		created: 1,
		model: "test-model",
		choices: [],
		usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
	};
}

function anthropicSse(records: readonly SseRecord[]): Response {
	return sseResponse(records);
}

function anthropicMessageStart(): SseRecord {
	return {
		event: "message_start",
		data: {
			type: "message_start",
			message: {
				id: "message-1",
				type: "message",
				role: "assistant",
				content: [],
				model: "test-model",
				stop_reason: null,
				stop_sequence: null,
				usage: { input_tokens: 3, output_tokens: 0 },
			},
		},
	};
}

function anthropicMessageDelta(stopReason: "end_turn" | "tool_use"): SseRecord {
	return {
		event: "message_delta",
		data: {
			type: "message_delta",
			delta: { stop_reason: stopReason, stop_sequence: null },
			usage: { output_tokens: 2 },
		},
	};
}
