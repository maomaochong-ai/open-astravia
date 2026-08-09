import type { ConverseStreamCommandInput, ConverseStreamOutput } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Context, LanguageModelStreamEvent, Model, ModelStreamResponse } from "../src/index.js";
import { AI_ERROR_CODES, type AIError } from "../src/protocol/index.js";
import { type BedrockCommandSender, createBedrockAdapter } from "../src/providers/amazon-bedrock/adapter.js";
import { anthropicAdapter } from "../src/providers/anthropic/adapter.js";
import { streamAnthropic } from "../src/providers/anthropic/stream.js";
import {
	createControlledSseResponse,
	createProviderTestTransport,
	emptySseResponse,
	errorResponse,
	type SseRecord,
	sseResponse,
} from "../src/testing/provider-test-transport.js";

const context: Context = {
	systemPrompt: "Be concise.",
	messages: [{ role: "user", content: "Hello", timestamp: 1 }],
};

const anthropicModel: Model<"anthropic-messages"> = createModel("anthropic-messages", "anthropic");
const bedrockModel: Model<"bedrock-converse-stream"> = {
	...createModel("bedrock-converse-stream", "amazon-bedrock"),
	id: "global.anthropic.claude-sonnet-4-6-v1",
	reasoning: true,
};

describe("Anthropic native adapter", () => {
	it("streams thinking, text, tools, signatures, cache usage, and a native terminal result", async () => {
		const transport = createProviderTestTransport([anthropicSse(anthropicSuccessfulRecords())]);
		const response = await anthropicAdapter.stream({
			model: anthropicModel,
			context,
			options: { apiKey: "test", fetch: transport.fetch },
		});

		const { events, result } = await collectNative(response);

		expect(events.map((event) => event.type)).toEqual([
			"start",
			"thinking_start",
			"thinking_delta",
			"thinking_end",
			"text_start",
			"text_delta",
			"text_end",
			"toolcall_start",
			"toolcall_delta",
			"toolcall_delta",
			"toolcall_end",
			"done",
		]);
		expect(result.content).toEqual([
			{ type: "thinking", thinking: "reason", thinkingSignature: "signature" },
			{ type: "text", text: "hello" },
			{ type: "toolCall", id: "call-1", name: "lookup", arguments: { query: "test" } },
		]);
		expect(result.stopReason).toBe("toolUse");
		expect(result.usage).toMatchObject({ input: 3, output: 2, cacheRead: 4, cacheWrite: 5, totalTokens: 14 });
		expect(JSON.parse(transport.requests[0]?.body ?? "{}")).toMatchObject({ model: anthropicModel.id, stream: true });
	});

	it("maps HTTP status failures on the native rejection channel", async () => {
		const rateLimitResponse = () =>
			errorResponse(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } });
		const transport = createProviderTestTransport([rateLimitResponse(), rateLimitResponse(), rateLimitResponse()]);

		await expectNativeFailure(
			anthropicAdapter.stream({
				model: anthropicModel,
				context,
				options: { apiKey: "test", fetch: transport.fetch },
			}),
			AI_ERROR_CODES.RATE_LIMITED,
		);
	});

	it.each([
		["empty stream", emptySseResponse(), AI_ERROR_CODES.STREAM_PROTOCOL_FAILED],
		[
			"missing message_stop",
			anthropicSse([anthropicMessageStart(), anthropicMessageDelta("end_turn")]),
			AI_ERROR_CODES.STREAM_PROTOCOL_FAILED,
		],
		[
			"open content block",
			anthropicSse([
				anthropicMessageStart(),
				anthropicTextStart(0),
				anthropicMessageDelta("end_turn"),
				{ event: "message_stop", data: { type: "message_stop" } },
			]),
			AI_ERROR_CODES.STREAM_PROTOCOL_FAILED,
		],
		[
			"delta before message_start",
			anthropicSse([
				{
					event: "content_block_delta",
					data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "bad" } },
				},
			]),
			AI_ERROR_CODES.STREAM_PROTOCOL_FAILED,
		],
		[
			"malformed wire event",
			anthropicSse([
				anthropicMessageStart(),
				{
					event: "content_block_start",
					data: { type: "content_block_start", index: "zero", content_block: { type: "text", text: "" } },
				},
			]),
			AI_ERROR_CODES.RESPONSE_VALIDATION_FAILED,
		],
	] as const)("rejects %s", async (_name, providerResponse, code) => {
		const transport = createProviderTestTransport([providerResponse]);
		await expectNativeFailure(
			anthropicAdapter.stream({
				model: anthropicModel,
				context,
				options: { apiKey: "test", fetch: transport.fetch },
			}),
			code,
		);
	});

	it("settles a request aborted before transport starts", async () => {
		const controller = new AbortController();
		controller.abort();
		const transport = createProviderTestTransport([anthropicSse(anthropicSuccessfulRecords())]);

		await expectNativeFailure(
			anthropicAdapter.stream({
				model: anthropicModel,
				context,
				options: { apiKey: "test", fetch: transport.fetch, signal: controller.signal },
			}),
			AI_ERROR_CODES.ABORTED,
		);
		expect(transport.requests).toHaveLength(0);
	});

	it("settles a request aborted during streaming", async () => {
		const controller = new AbortController();
		const controlled = createControlledSseResponse();
		const transport = createProviderTestTransport([controlled.response]);
		const response = await anthropicAdapter.stream({
			model: anthropicModel,
			context,
			options: { apiKey: "test", fetch: transport.fetch, signal: controller.signal },
		});
		const settlement = settleNative(response);
		await waitFor(() => transport.requests.length === 1);
		controlled.emit(anthropicMessageStart());
		controller.abort();
		controlled.close();

		await expect(settlement).rejects.toMatchObject({ code: AI_ERROR_CODES.ABORTED });
	});

	it("keeps the legacy stream as a one-way error-event projection", async () => {
		const transport = createProviderTestTransport([anthropicSse([anthropicMessageStart()])]);
		const stream = streamAnthropic(anthropicModel, context, { apiKey: "test", fetch: transport.fetch });
		const events = [];
		for await (const event of stream) events.push(event);

		expect(events.at(-1)).toMatchObject({ type: "error", reason: "error" });
		expect((await stream.result()).errorMessage).toContain("message_stop");
	});
});

describe("Amazon Bedrock native adapter", () => {
	it("streams reasoning, text, tools, usage, and observes request options", async () => {
		let observedInput: ConverseStreamCommandInput | undefined;
		let observedSignal: AbortSignal | undefined;
		const controller = new AbortController();
		const send: BedrockCommandSender = async (input, options) => {
			observedInput = input;
			observedSignal = options.signal;
			return { stream: wireEvents(bedrockSuccessfulEvents()) };
		};
		const adapter = createBedrockAdapter({ send });

		const { events, result } = await collectNative(
			await adapter.stream({
				model: bedrockModel,
				context,
				options: { signal: controller.signal, region: "eu-west-1" },
			}),
		);

		expect(events.map((event) => event.type)).toEqual([
			"start",
			"thinking_start",
			"thinking_delta",
			"thinking_end",
			"text_start",
			"text_delta",
			"text_end",
			"toolcall_start",
			"toolcall_delta",
			"toolcall_delta",
			"toolcall_end",
			"done",
		]);
		expect(result.content).toEqual([
			{ type: "thinking", thinking: "reason", thinkingSignature: "signature" },
			{ type: "text", text: "hello" },
			{ type: "toolCall", id: "call-1", name: "lookup", arguments: { query: "test" } },
		]);
		expect(result.stopReason).toBe("toolUse");
		expect(result.usage).toMatchObject({ input: 3, output: 2, cacheRead: 4, cacheWrite: 5, totalTokens: 14 });
		expect(observedInput).toMatchObject({ modelId: bedrockModel.id });
		expect(observedSignal).toBe(controller.signal);
	});

	it.each([
		["empty stream", [], AI_ERROR_CODES.STREAM_PROTOCOL_FAILED],
		["missing messageStop", [{ messageStart: { role: "assistant" } }], AI_ERROR_CODES.STREAM_PROTOCOL_FAILED],
		[
			"open content block",
			[
				{ messageStart: { role: "assistant" } },
				{ contentBlockDelta: { contentBlockIndex: 0, delta: { text: "open" } } },
				{ messageStop: { stopReason: "end_turn" } },
			],
			AI_ERROR_CODES.STREAM_PROTOCOL_FAILED,
		],
		[
			"delta before messageStart",
			[{ contentBlockDelta: { contentBlockIndex: 0, delta: { text: "bad" } } }],
			AI_ERROR_CODES.STREAM_PROTOCOL_FAILED,
		],
		[
			"malformed wire event",
			[
				{ messageStart: { role: "assistant" } },
				{ contentBlockDelta: { contentBlockIndex: "zero", delta: { text: "bad" } } },
			],
			AI_ERROR_CODES.RESPONSE_VALIDATION_FAILED,
		],
	] as const)("rejects %s", async (_name, events, code) => {
		const adapter = createBedrockAdapter({ send: senderFor(events) });
		await expectNativeFailure(adapter.stream({ model: bedrockModel, context }), code);
	});

	it("maps streamed throttling exceptions to the stable rate-limit error", async () => {
		const adapter = createBedrockAdapter({
			send: senderFor([{ throttlingException: { message: "slow down" } }]),
		});

		await expectNativeFailure(adapter.stream({ model: bedrockModel, context }), AI_ERROR_CODES.RATE_LIMITED);
	});

	it("maps AWS SDK response metadata to the stable permission error", async () => {
		const sdkError = Object.assign(new Error("denied"), { $metadata: { httpStatusCode: 403 } });
		const adapter = createBedrockAdapter({ send: vi.fn().mockRejectedValue(sdkError) });

		await expectNativeFailure(adapter.stream({ model: bedrockModel, context }), AI_ERROR_CODES.PERMISSION_DENIED);
	});

	it("does not call the sender when already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const send = vi.fn<BedrockCommandSender>();
		const adapter = createBedrockAdapter({ send });

		await expectNativeFailure(
			adapter.stream({ model: bedrockModel, context, options: { signal: controller.signal } }),
			AI_ERROR_CODES.ABORTED,
		);
		expect(send).not.toHaveBeenCalled();
	});

	it("settles a request aborted while consuming the event stream", async () => {
		const controller = new AbortController();
		const adapter = createBedrockAdapter({
			send: async () => ({
				stream: wireEvents(
					[{ messageStart: { role: "assistant" } }, { messageStop: { stopReason: "end_turn" } }],
					() => controller.abort(),
				),
			}),
		});

		await expectNativeFailure(
			adapter.stream({ model: bedrockModel, context, options: { signal: controller.signal } }),
			AI_ERROR_CODES.ABORTED,
		);
	});
});

async function collectNative(response: ModelStreamResponse): Promise<{
	events: LanguageModelStreamEvent[];
	result: AssistantMessage;
}> {
	const events: LanguageModelStreamEvent[] = [];
	for await (const event of response.events) events.push(event);
	return { events, result: await response.result };
}

async function settleNative(response: ModelStreamResponse): Promise<void> {
	await Promise.all([collectEvents(response.events), response.result]);
}

async function expectNativeFailure(
	responsePromise: Promise<ModelStreamResponse>,
	code: AIError["code"],
): Promise<void> {
	const response = await responsePromise;
	const settlement = Promise.all([collectEvents(response.events), response.result]);
	await expect(settlement).rejects.toMatchObject({ code } satisfies Partial<AIError>);
}

async function collectEvents(events: AsyncIterable<LanguageModelStreamEvent>): Promise<LanguageModelStreamEvent[]> {
	const result: LanguageModelStreamEvent[] = [];
	for await (const event of events) result.push(event);
	return result;
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("Timed out waiting for test condition");
}

function anthropicSuccessfulRecords(): SseRecord[] {
	return [
		anthropicMessageStart(),
		{
			event: "content_block_start",
			data: {
				type: "content_block_start",
				index: 0,
				content_block: { type: "thinking", thinking: "", signature: "" },
			},
		},
		{
			event: "content_block_delta",
			data: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "reason" } },
		},
		{
			event: "content_block_delta",
			data: { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "signature" } },
		},
		{ event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
		anthropicTextStart(1),
		{
			event: "content_block_delta",
			data: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "hello" } },
		},
		{ event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
		{
			event: "content_block_start",
			data: {
				type: "content_block_start",
				index: 2,
				content_block: { type: "tool_use", id: "call-1", name: "lookup", input: {} },
			},
		},
		{
			event: "content_block_delta",
			data: {
				type: "content_block_delta",
				index: 2,
				delta: { type: "input_json_delta", partial_json: '{"query":' },
			},
		},
		{
			event: "content_block_delta",
			data: { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '"test"}' } },
		},
		{ event: "content_block_stop", data: { type: "content_block_stop", index: 2 } },
		anthropicMessageDelta("tool_use"),
		{ event: "message_stop", data: { type: "message_stop" } },
	];
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
				model: anthropicModel.id,
				stop_reason: null,
				stop_sequence: null,
				usage: {
					input_tokens: 3,
					output_tokens: 0,
					cache_read_input_tokens: 4,
					cache_creation_input_tokens: 5,
				},
			},
		},
	};
}

function anthropicTextStart(index: number): SseRecord {
	return {
		event: "content_block_start",
		data: { type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } },
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

function anthropicSse(records: readonly SseRecord[]): Response {
	return sseResponse(records);
}

function bedrockSuccessfulEvents(): unknown[] {
	return [
		{ messageStart: { role: "assistant" } },
		{ contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: "reason" } } } },
		{ contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { signature: "signature" } } } },
		{ contentBlockStop: { contentBlockIndex: 0 } },
		{ contentBlockDelta: { contentBlockIndex: 1, delta: { text: "hello" } } },
		{ contentBlockStop: { contentBlockIndex: 1 } },
		{ contentBlockStart: { contentBlockIndex: 2, start: { toolUse: { toolUseId: "call-1", name: "lookup" } } } },
		{ contentBlockDelta: { contentBlockIndex: 2, delta: { toolUse: { input: '{"query":' } } } },
		{ contentBlockDelta: { contentBlockIndex: 2, delta: { toolUse: { input: '"test"}' } } } },
		{ contentBlockStop: { contentBlockIndex: 2 } },
		{ messageStop: { stopReason: "tool_use" } },
		{
			metadata: {
				usage: {
					inputTokens: 3,
					outputTokens: 2,
					cacheReadInputTokens: 4,
					cacheWriteInputTokens: 5,
					totalTokens: 14,
				},
			},
		},
	];
}

function senderFor(events: readonly unknown[]): BedrockCommandSender {
	return async () => ({ stream: wireEvents(events) });
}

async function* wireEvents(events: readonly unknown[], onFirstEvent?: () => void): AsyncIterable<ConverseStreamOutput> {
	for (let index = 0; index < events.length; index++) {
		yield events[index] as ConverseStreamOutput;
		if (index === 0) onFirstEvent?.();
	}
}

function createModel<TApi extends "anthropic-messages" | "bedrock-converse-stream">(
	api: TApi,
	provider: string,
): Model<TApi> {
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
