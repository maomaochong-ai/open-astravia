import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it } from "vitest";
import { azureOpenAIResponsesAdapter, streamAzureOpenAIResponses } from "../src/providers/azure-openai-responses.js";
import { openAICodexResponsesAdapter, streamOpenAICodexResponses } from "../src/providers/openai-codex-responses.js";
import { openAIResponsesAdapter, streamOpenAIResponses } from "../src/providers/openai-responses.js";
import type { ModelStreamResponse } from "../src/runtime/language-model-adapter.js";
import { streamModel } from "../src/runtime/stream-model.js";
import {
	createControlledSseResponse,
	createProviderTestTransport,
	emptySseResponse,
	errorResponse,
	sseResponse,
} from "../src/testing/provider-test-transport.js";
import type { Api, AssistantMessage, AssistantMessageEvent, Context, FetchFunction, Model } from "../src/types.js";
import type { AssistantMessageEventStream } from "../src/utils/event-stream.js";

interface ResponsesFamilyFixture {
	readonly api: Api;
	readonly model: Model<Api>;
	stream(fetch: FetchFunction, signal?: AbortSignal): Promise<ModelStreamResponse>;
	legacy(fetch: FetchFunction): AssistantMessageEventStream;
}

const context: Context = {
	systemPrompt: "Be concise.",
	messages: [{ role: "user", content: "Hello", timestamp: 1 }],
	tools: [
		{
			name: "lookup",
			description: "Look up a value",
			parameters: Type.Object({ query: Type.String() }),
		},
	],
};

const codexToken = createCodexToken();
const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
const openAIModel = createModel("openai-responses", "openai", "https://provider.test/v1");
const azureModel = createModel("azure-openai-responses", "azure-openai-responses", "https://azure.test/openai/v1");
const codexModel = createModel("openai-codex-responses", "openai-codex", "https://chatgpt.test/backend-api");

const fixtures: readonly ResponsesFamilyFixture[] = [
	{
		api: "openai-responses",
		model: openAIModel,
		stream: (fetch, signal) =>
			openAIResponsesAdapter.stream({
				model: openAIModel,
				context,
				options: { apiKey: "test", fetch, signal },
			}),
		legacy: (fetch) => streamOpenAIResponses(openAIModel, context, { apiKey: "test", fetch }),
	},
	{
		api: "azure-openai-responses",
		model: azureModel,
		stream: (fetch, signal) =>
			azureOpenAIResponsesAdapter.stream({
				model: azureModel,
				context,
				options: { apiKey: "test", azureBaseUrl: azureModel.baseUrl, fetch, signal },
			}),
		legacy: (fetch) =>
			streamAzureOpenAIResponses(azureModel, context, {
				apiKey: "test",
				azureBaseUrl: azureModel.baseUrl,
				fetch,
			}),
	},
	{
		api: "openai-codex-responses",
		model: codexModel,
		stream: (fetch, signal) =>
			openAICodexResponsesAdapter.stream({
				model: codexModel,
				context,
				options: { apiKey: codexToken, fetch, signal, transport: "sse" },
			}),
		legacy: (fetch) =>
			streamOpenAICodexResponses(codexModel, context, {
				apiKey: codexToken,
				fetch,
				transport: "sse",
			}),
	},
];

afterEach(() => {
	const globals = globalThis as { WebSocket?: unknown };
	if (originalWebSocket === undefined) {
		Reflect.deleteProperty(globals, "WebSocket");
	} else {
		globals.WebSocket = originalWebSocket;
	}
	FakeWebSocket.onSend = undefined;
	FakeWebSocket.instances = [];
});

for (const fixture of fixtures) {
	describe(`${fixture.api} native adapter`, () => {
		it("streams text, usage, lifecycle, and request payload", async () => {
			const transport = createProviderTestTransport([responsesSse(textEvents())]);
			const response = await fixture.stream(transport.fetch);
			const events = await collectEvents(response.events);
			const result = await response.result;

			expect(textOf(result)).toBe("hello");
			expect(result).toMatchObject({ api: fixture.api, stopReason: "stop" });
			expect(result.usage).toMatchObject({ input: 3, output: 2, totalTokens: 5 });
			expect(events.map((event) => event.type)).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);
			expect(transport.requests).toHaveLength(1);
			expect(JSON.parse(transport.requests[0]?.body ?? "{}")).toMatchObject({ stream: true });
		});

		it("streams tool arguments and returns toolUse", async () => {
			const transport = createProviderTestTransport([responsesSse(toolEvents())]);
			const response = await fixture.stream(transport.fetch);
			const events = await collectEvents(response.events);
			const result = await response.result;
			const toolCall = result.content.find((block) => block.type === "toolCall");

			expect(toolCall).toMatchObject({
				id: "call-1|fc-1",
				name: "lookup",
				arguments: { query: "test" },
			});
			expect(result.stopReason).toBe("toolUse");
			expect(events.map((event) => event.type)).toContain("toolcall_delta");
			expect(events.map((event) => event.type)).toContain("toolcall_end");
		});

		it("rejects malformed wire payloads through the native failure channel", async () => {
			const transport = createProviderTestTransport([
				responsesSse([{ type: "response.output_text.delta", output_index: 0, delta: 42 }]),
			]);
			const response = await fixture.stream(transport.fetch);
			const settled = await settleResponse(response);

			expect(settled.eventError).toMatchObject({ code: "AI_RESPONSE_VALIDATION_FAILED" });
			expect(settled.resultError).toMatchObject({ code: "AI_RESPONSE_VALIDATION_FAILED" });
		});

		it("rejects streams that end without a terminal response", async () => {
			const transport = createProviderTestTransport([
				responsesSse([{ type: "response.created", response: { status: "in_progress" } }]),
			]);
			const response = await fixture.stream(transport.fetch);
			const settled = await settleResponse(response);

			expect(settled.eventError).toMatchObject({ code: "AI_STREAM_PROTOCOL_FAILED" });
			expect(settled.resultError).toMatchObject({ code: "AI_STREAM_PROTOCOL_FAILED" });
		});

		it("rejects an empty provider stream", async () => {
			const transport = createProviderTestTransport([emptySseResponse()]);
			const response = await fixture.stream(transport.fetch);
			const settled = await settleResponse(response);

			expect(settled.eventError).toMatchObject({
				code: "AI_STREAM_PROTOCOL_FAILED",
				metadata: { reason: "empty_provider_stream" },
			});
			expect(settled.resultError).toMatchObject({ code: "AI_STREAM_PROTOCOL_FAILED" });
		});

		it("returns a successful length terminal for response.incomplete", async () => {
			const transport = createProviderTestTransport([responsesSse(incompleteEvents())]);
			const response = await fixture.stream(transport.fetch);
			const events = await collectEvents(response.events);
			const result = await response.result;

			expect(result.stopReason).toBe("length");
			expect(events.at(-1)).toMatchObject({ type: "done", reason: "length" });
		});

		it("rejects response.failed instead of producing completed(error)", async () => {
			const transport = createProviderTestTransport([responsesSse([failedEvent()])]);
			const response = await fixture.stream(transport.fetch);
			const settled = await settleResponse(response);

			expect(settled.eventError).toMatchObject({ code: "AI_TRANSPORT_FAILED" });
			expect(settled.resultError).toMatchObject({ code: "AI_TRANSPORT_FAILED" });
		});

		it("maps HTTP errors without converting them into successful results", async () => {
			const transport = createProviderTestTransport([
				errorResponse(400, { error: { type: "invalid_request_error", message: "bad request" } }),
			]);
			const response = await fixture.stream(transport.fetch);
			const settled = await settleResponse(response);

			expect(settled.eventError).toMatchObject({ code: "AI_INVALID_REQUEST", statusCode: 400 });
			expect(settled.resultError).toMatchObject({ code: "AI_INVALID_REQUEST", statusCode: 400 });
		});

		it("settles an already aborted call without touching transport", async () => {
			const controller = new AbortController();
			controller.abort();
			const transport = createProviderTestTransport([responsesSse(textEvents())]);
			const response = await fixture.stream(transport.fetch, controller.signal);
			const settled = await settleResponse(response);

			expect(settled.eventError).toMatchObject({ code: "AI_ABORTED" });
			expect(settled.resultError).toMatchObject({ code: "AI_ABORTED" });
			expect(transport.requests).toHaveLength(0);
		});

		it("preserves the legacy error terminal only at the compatibility boundary", async () => {
			const transport = createProviderTestTransport([emptySseResponse()]);
			const stream = fixture.legacy(transport.fetch);
			const events: AssistantMessageEvent[] = [];
			for await (const event of stream) events.push(event);
			const result = await stream.result();

			expect(result.stopReason).toBe("error");
			expect(events.at(-1)?.type).toBe("error");
		});
	});
}

describe("Responses family streaming laws", () => {
	it("uses the native adapters through the default registry", async () => {
		for (const fixture of fixtures) {
			const transport = createProviderTestTransport([
				responsesSse([{ type: "response.output_text.delta", output_index: 0, delta: 42 }]),
			]);
			const response = await streamModel({
				model: fixture.model,
				context,
				options: {
					apiKey: fixture.api === "openai-codex-responses" ? codexToken : "test",
					fetch: transport.fetch,
					transport: "sse",
				},
			});
			const settled = await settleResponse(response);

			expect(settled.resultError).toMatchObject({ code: "AI_RESPONSE_VALIDATION_FAILED" });
		}
	});

	it("routes interleaved deltas by output_index", async () => {
		const transport = createProviderTestTransport([responsesSse(interleavedEvents())]);
		const response = await openAIResponsesAdapter.stream({
			model: openAIModel,
			context,
			options: { apiKey: "test", fetch: transport.fetch },
		});
		const result = await response.result;

		expect(result.content).toMatchObject([
			{ type: "text", text: "hello" },
			{ type: "toolCall", name: "lookup", arguments: { query: "test" } },
		]);
	});

	it("propagates cancellation after transport starts", async () => {
		for (const fixture of fixtures) {
			const controlled = createControlledSseResponse();
			const controller = new AbortController();
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
			const response = await fixture.stream(transport.fetch, controller.signal);
			const iterator = response.events[Symbol.asyncIterator]();
			await expect(iterator.next()).resolves.toMatchObject({ value: { type: "start" } });

			controller.abort();
			const [eventResult, messageResult] = await Promise.allSettled([iterator.next(), response.result]);
			expect(eventResult).toMatchObject({ status: "rejected", reason: { code: "AI_ABORTED" } });
			expect(messageResult).toMatchObject({ status: "rejected", reason: { code: "AI_ABORTED" } });
		}
	});

	it("classifies malformed Codex SSE JSON as response validation failure", async () => {
		const transport = createProviderTestTransport([responsesSse(["{not-json"])]);
		const response = await openAICodexResponsesAdapter.stream({
			model: codexModel,
			context,
			options: { apiKey: codexToken, fetch: transport.fetch, transport: "sse" },
		});
		const settled = await settleResponse(response);

		expect(settled.eventError).toMatchObject({ code: "AI_RESPONSE_VALIDATION_FAILED" });
		expect(settled.resultError).toMatchObject({ code: "AI_RESPONSE_VALIDATION_FAILED" });
	});
});

describe("Responses family request mapping", () => {
	it("preserves OpenAI cache, reasoning, service-tier, and pricing options", async () => {
		const model: Model<"openai-responses"> = {
			...openAIModel,
			baseUrl: "https://api.openai.com/v1",
			reasoning: true,
			cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
		};
		let payload: unknown;
		const transport = createProviderTestTransport([responsesSse(textEvents("priority"))]);
		const response = await openAIResponsesAdapter.stream({
			model,
			context,
			options: {
				apiKey: "test",
				fetch: transport.fetch,
				sessionId: "session-1",
				cacheRetention: "long",
				reasoningEffort: "high",
				serviceTier: "priority",
				onPayload: (value) => {
					payload = value;
				},
			},
		});
		const result = await response.result;

		expect(payload).toMatchObject({
			prompt_cache_key: "session-1",
			prompt_cache_retention: "24h",
			reasoning: { effort: "high", summary: "auto" },
			include: ["reasoning.encrypted_content"],
			service_tier: "priority",
		});
		expect(result.usage.cost.total).toBeCloseTo(0.00001);
	});

	it("keeps Azure deployment and endpoint options outside the shared reducer", async () => {
		const model: Model<"azure-openai-responses"> = {
			...azureModel,
			name: "GPT-5 Test",
			reasoning: true,
		};
		let payload: unknown;
		const transport = createProviderTestTransport([responsesSse(textEvents())]);
		const response = await azureOpenAIResponsesAdapter.stream({
			model,
			context,
			options: {
				apiKey: "test",
				fetch: transport.fetch,
				azureBaseUrl: "https://resource.test/openai/v1",
				azureDeploymentName: "deployment-1",
				reasoningEffort: "high",
				onPayload: (value) => {
					payload = value;
				},
			},
		});
		await response.result;

		expect(payload).toMatchObject({
			model: "deployment-1",
			reasoning: { effort: "high", summary: "auto" },
			include: ["reasoning.encrypted_content"],
		});
		expect(transport.requests[0]?.url).toContain("resource.test");
	});

	it("maps Codex session identity to headers and in-memory prompt caching", async () => {
		const transport = createProviderTestTransport([responsesSse(textEvents())]);
		const response = await openAICodexResponsesAdapter.stream({
			model: codexModel,
			context,
			options: {
				apiKey: codexToken,
				fetch: transport.fetch,
				transport: "sse",
				sessionId: "session-1",
			},
		});
		await response.result;

		const request = transport.requests[0];
		expect(request?.headers.get("conversation_id")).toBe("session-1");
		expect(request?.headers.get("session_id")).toBe("session-1");
		expect(JSON.parse(request?.body ?? "{}")).toMatchObject({
			prompt_cache_key: "session-1",
			prompt_cache_retention: "in-memory",
		});
	});
});

describe("Codex Responses WebSocket transport", () => {
	it("streams successful frames through the native adapter", async () => {
		installFakeWebSocket((socket) => {
			queueMicrotask(() => {
				for (const event of textEvents()) socket.emit("message", { data: JSON.stringify(event) });
			});
		});
		const response = await openAICodexResponsesAdapter.stream({
			model: codexModel,
			context,
			options: { apiKey: codexToken, transport: "websocket" },
		});
		const result = await response.result;

		expect(textOf(result)).toBe("hello");
		expect(FakeWebSocket.instances[0]?.url).toBe("wss://chatgpt.test/backend-api/codex/responses");
		expect(JSON.parse(FakeWebSocket.instances[0]?.sent[0] ?? "{}")).toMatchObject({
			type: "response.create",
			stream: true,
		});
	});

	it("rejects malformed JSON frames", async () => {
		installFakeWebSocket((socket) => {
			queueMicrotask(() => socket.emit("message", { data: "{not-json" }));
		});
		const response = await openAICodexResponsesAdapter.stream({
			model: codexModel,
			context,
			options: { apiKey: codexToken, transport: "websocket" },
		});
		const settled = await settleResponse(response);

		expect(settled.eventError).toMatchObject({ code: "AI_RESPONSE_VALIDATION_FAILED" });
		expect(settled.resultError).toMatchObject({ code: "AI_RESPONSE_VALIDATION_FAILED" });
	});

	it("rejects a socket that closes before a terminal response", async () => {
		installFakeWebSocket((socket) => {
			queueMicrotask(() => socket.emit("close", { code: 1006, reason: "lost" }));
		});
		const response = await openAICodexResponsesAdapter.stream({
			model: codexModel,
			context,
			options: { apiKey: codexToken, transport: "websocket" },
		});
		const settled = await settleResponse(response);

		expect(settled.eventError).toMatchObject({ code: "AI_TRANSPORT_FAILED" });
		expect(settled.resultError).toMatchObject({ code: "AI_TRANSPORT_FAILED" });
	});

	it("propagates cancellation after the socket starts", async () => {
		let markRequestSent: (() => void) | undefined;
		const requestSent = new Promise<void>((resolve) => {
			markRequestSent = resolve;
		});
		installFakeWebSocket(() => markRequestSent?.());
		const controller = new AbortController();
		const response = await openAICodexResponsesAdapter.stream({
			model: codexModel,
			context,
			options: { apiKey: codexToken, transport: "websocket", signal: controller.signal },
		});
		const events = collectEvents(response.events);
		await requestSent;

		controller.abort();
		const [eventResult, messageResult] = await Promise.allSettled([events, response.result]);
		expect(eventResult).toMatchObject({ status: "rejected", reason: { code: "AI_ABORTED" } });
		expect(messageResult).toMatchObject({ status: "rejected", reason: { code: "AI_ABORTED" } });
	});
});

async function collectEvents(events: AsyncIterable<AssistantMessageEvent>): Promise<AssistantMessageEvent[]> {
	const collected: AssistantMessageEvent[] = [];
	for await (const event of events) collected.push(event);
	return collected;
}

async function settleResponse(response: ModelStreamResponse): Promise<{ eventError: unknown; resultError: unknown }> {
	const [eventSettlement, resultSettlement] = await Promise.allSettled([
		collectEvents(response.events),
		response.result,
	]);
	return {
		eventError: eventSettlement.status === "rejected" ? eventSettlement.reason : undefined,
		resultError: resultSettlement.status === "rejected" ? resultSettlement.reason : undefined,
	};
}

function responsesSse(events: readonly unknown[]): Response {
	return sseResponse([...events.map((data) => ({ data })), { data: "[DONE]" }]);
}

function textEvents(serviceTier?: string): unknown[] {
	return [
		messageAdded(0, "msg-1"),
		{
			type: "response.content_part.added",
			output_index: 0,
			part: { type: "output_text", text: "", annotations: [] },
		},
		{ type: "response.output_text.delta", output_index: 0, delta: "hello" },
		messageDone(0, "msg-1", "hello"),
		completedEvent(serviceTier),
	];
}

function toolEvents(): unknown[] {
	return [
		toolAdded(0),
		{ type: "response.function_call_arguments.delta", output_index: 0, delta: '{"query":' },
		{
			type: "response.function_call_arguments.delta",
			output_index: 0,
			delta: '"test"}',
		},
		{
			type: "response.function_call_arguments.done",
			output_index: 0,
			arguments: '{"query":"test"}',
			name: "lookup",
		},
		toolDone(0),
		completedEvent(),
	];
}

function interleavedEvents(): unknown[] {
	return [
		messageAdded(0, "msg-1"),
		toolAdded(1),
		{ type: "response.output_text.delta", output_index: 0, delta: "hello" },
		{ type: "response.function_call_arguments.delta", output_index: 1, delta: '{"query":"test"}' },
		messageDone(0, "msg-1", "hello"),
		toolDone(1),
		completedEvent(),
	];
}

function messageAdded(outputIndex: number, id: string): unknown {
	return {
		type: "response.output_item.added",
		output_index: outputIndex,
		item: { type: "message", id, role: "assistant", status: "in_progress", content: [] },
	};
}

function messageDone(outputIndex: number, id: string, text: string): unknown {
	return {
		type: "response.output_item.done",
		output_index: outputIndex,
		item: {
			type: "message",
			id,
			role: "assistant",
			status: "completed",
			content: [{ type: "output_text", text, annotations: [] }],
		},
	};
}

function toolAdded(outputIndex: number): unknown {
	return {
		type: "response.output_item.added",
		output_index: outputIndex,
		item: {
			type: "function_call",
			id: "fc-1",
			call_id: "call-1",
			name: "lookup",
			arguments: "",
			status: "in_progress",
		},
	};
}

function toolDone(outputIndex: number): unknown {
	return {
		type: "response.output_item.done",
		output_index: outputIndex,
		item: {
			type: "function_call",
			id: "fc-1",
			call_id: "call-1",
			name: "lookup",
			arguments: '{"query":"test"}',
			status: "completed",
		},
	};
}

function completedEvent(serviceTier?: string): unknown {
	return {
		type: "response.completed",
		response: {
			id: "response-1",
			object: "response",
			status: "completed",
			service_tier: serviceTier,
			output: [],
			usage: {
				input_tokens: 3,
				output_tokens: 2,
				total_tokens: 5,
				input_tokens_details: { cached_tokens: 0 },
			},
		},
	};
}

function incompleteEvents(): unknown[] {
	return [
		messageAdded(0, "msg-1"),
		messageDone(0, "msg-1", "partial"),
		{
			type: "response.incomplete",
			response: {
				id: "response-1",
				object: "response",
				status: "incomplete",
				output: [],
				usage: {
					input_tokens: 3,
					output_tokens: 2,
					total_tokens: 5,
					input_tokens_details: { cached_tokens: 0 },
				},
			},
		},
	];
}

function failedEvent(): unknown {
	return {
		type: "response.failed",
		response: {
			id: "response-1",
			object: "response",
			status: "failed",
			output: [],
			error: { code: "provider_failed", message: "provider failed" },
		},
	};
}

function textOf(message: AssistantMessage): string {
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function createModel<TApi extends Api>(api: TApi, provider: string, baseUrl: string): Model<TApi> {
	return {
		id: "test-model",
		name: "Test Model",
		api,
		provider,
		baseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000,
		maxTokens: 100,
	};
}

function createCodexToken(): string {
	const payload = Buffer.from(
		JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account-1" } }),
		"utf8",
	).toString("base64");
	return `header.${payload}.signature`;
}

type FakeWebSocketEventType = "open" | "message" | "error" | "close";
type FakeWebSocketListener = (event: unknown) => void;

class FakeWebSocket {
	static instances: FakeWebSocket[] = [];
	static onSend: ((socket: FakeWebSocket, data: string) => void) | undefined;

	readonly url: string;
	readonly sent: string[] = [];
	readyState = 0;
	readonly #listeners = new Map<FakeWebSocketEventType, Set<FakeWebSocketListener>>();

	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
		queueMicrotask(() => {
			this.readyState = 1;
			this.emit("open", {});
		});
	}

	send(data: string): void {
		this.sent.push(data);
		FakeWebSocket.onSend?.(this, data);
	}

	close(code = 1000, reason = "done"): void {
		this.readyState = 3;
		this.emit("close", { code, reason });
	}

	addEventListener(type: FakeWebSocketEventType, listener: FakeWebSocketListener): void {
		const listeners = this.#listeners.get(type) ?? new Set<FakeWebSocketListener>();
		listeners.add(listener);
		this.#listeners.set(type, listeners);
	}

	removeEventListener(type: FakeWebSocketEventType, listener: FakeWebSocketListener): void {
		this.#listeners.get(type)?.delete(listener);
	}

	emit(type: FakeWebSocketEventType, event: unknown): void {
		for (const listener of this.#listeners.get(type) ?? []) listener(event);
	}
}

function installFakeWebSocket(onSend: (socket: FakeWebSocket, data: string) => void): void {
	FakeWebSocket.onSend = onSend;
	(globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
}
