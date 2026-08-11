import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import type { AssistantMessage, Context, LanguageModelStreamEvent, Model, ModelStreamResponse } from "../src/index.js";
import { AI_ERROR_CODES, type AIError } from "../src/protocol/index.js";
import { createGoogleAdapter, type GoogleContentSender } from "../src/providers/google.js";
import { googleGeminiCliAdapter } from "../src/providers/google-gemini-cli.js";
import { createGoogleVertexAdapter, type GoogleVertexContentSender } from "../src/providers/google-vertex.js";

const context: Context = {
	systemPrompt: "Be concise.",
	messages: [{ role: "user", content: "Hello", timestamp: 1 }],
	tools: [{ name: "lookup", description: "Lookup data", parameters: Type.Object({ query: Type.String() }) }],
};

const googleModel = createModel("google-generative-ai", "google");
const vertexModel = createModel("google-vertex", "google-vertex");
const cliModel = createModel("google-gemini-cli", "google-gemini-cli");
const cliApiKey = JSON.stringify({ token: "test-token", projectId: "test-project" });

describe("Google Generative AI native adapter", () => {
	it("streams thinking, text, tools, signatures, usage, and request parameters", async () => {
		let observedParams: Parameters<GoogleContentSender>[0] | undefined;
		const send: GoogleContentSender = async (params) => {
			observedParams = params;
			return chunks(successfulChunks());
		};
		const adapter = createGoogleAdapter({ send });

		const { events, result } = await collectNative(
			await adapter.stream({
				model: googleModel,
				context,
				options: {
					apiKey: "test-key",
					maxTokens: 100,
					thinking: { enabled: true, budgetTokens: 32 },
					toolChoice: "auto",
				},
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
			"toolcall_end",
			"done",
		]);
		expect(result.content).toEqual([
			{ type: "thinking", thinking: "reason", thinkingSignature: "thought-sig" },
			{ type: "text", text: "hello", textSignature: "text-sig" },
			{
				type: "toolCall",
				id: "call-1",
				name: "lookup",
				arguments: { query: "test" },
				thoughtSignature: "tool-sig",
			},
		]);
		expect(result.stopReason).toBe("toolUse");
		expect(result.usage).toMatchObject({ input: 7, output: 6, cacheRead: 3, totalTokens: 16 });
		expect(observedParams).toMatchObject({
			model: googleModel.id,
			config: {
				maxOutputTokens: 100,
				systemInstruction: "Be concise.",
				thinkingConfig: { includeThoughts: true, thinkingBudget: 32 },
			},
		});
	});

	it.each([
		["empty stream", [], AI_ERROR_CODES.STREAM_PROTOCOL_FAILED],
		[
			"missing finishReason",
			[{ candidates: [{ content: { role: "model", parts: [{ text: "open" }] } }] }],
			AI_ERROR_CODES.STREAM_PROTOCOL_FAILED,
		],
		[
			"candidate after finishReason",
			[
				{ candidates: [{ finishReason: "STOP" }] },
				{ candidates: [{ content: { role: "model", parts: [{ text: "late" }] } }] },
			],
			AI_ERROR_CODES.STREAM_PROTOCOL_FAILED,
		],
		[
			"malformed wire chunk",
			[{ candidates: [{ content: { role: "model", parts: [{ text: 42 }] } }] }],
			AI_ERROR_CODES.RESPONSE_VALIDATION_FAILED,
		],
		[
			"failed provider finish reason",
			[{ candidates: [{ finishReason: "SAFETY" }] }],
			AI_ERROR_CODES.TRANSPORT_FAILED,
		],
	] as const)("rejects %s", async (_name, values, code) => {
		const adapter = createGoogleAdapter({ send: async () => chunks(values) });
		await expectNativeFailure(adapter.stream({ model: googleModel, context }), code);
	});

	it("does not call the sender when already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const send = vi.fn<GoogleContentSender>();
		const adapter = createGoogleAdapter({ send });

		await expectNativeFailure(
			adapter.stream({ model: googleModel, context, options: { signal: controller.signal } }),
			AI_ERROR_CODES.ABORTED,
		);
		expect(send).not.toHaveBeenCalled();
	});

	it("settles an abort observed while consuming provider chunks", async () => {
		const controller = new AbortController();
		const adapter = createGoogleAdapter({
			send: async () =>
				chunks([{ candidates: [{ finishReason: "STOP" }] }], () => {
					controller.abort();
				}),
		});

		await expectNativeFailure(
			adapter.stream({ model: googleModel, context, options: { signal: controller.signal } }),
			AI_ERROR_CODES.ABORTED,
		);
	});
});

describe("Google Vertex native adapter", () => {
	it("keeps Vertex identity options in transport while sharing the Gemini event reducer", async () => {
		let observedRequest: Parameters<GoogleVertexContentSender>[1] | undefined;
		const send: GoogleVertexContentSender = async (_params, request) => {
			observedRequest = request;
			return chunks([
				{ candidates: [{ content: { role: "model", parts: [{ text: "vertex" }] } }] },
				{ candidates: [{ finishReason: "MAX_TOKENS" }], usageMetadata: { totalTokenCount: 2 } },
			]);
		};
		const adapter = createGoogleVertexAdapter({ send });
		const { result } = await collectNative(
			await adapter.stream({
				model: vertexModel,
				context,
				options: { project: "project", location: "us-central1", thinking: { enabled: true, level: "HIGH" } },
			}),
		);

		expect(result.content).toEqual([{ type: "text", text: "vertex" }]);
		expect(result.stopReason).toBe("length");
		expect(observedRequest?.options).toMatchObject({ project: "project", location: "us-central1" });
	});
});

describe("Google Gemini CLI native adapter", () => {
	it("parses Cloud Code SSE through the shared reducer", async () => {
		const fetch = vi.fn(async () => sseResponse(successfulChunks().map((response) => ({ response }))));
		const { events, result } = await collectNative(
			await googleGeminiCliAdapter.stream({
				model: cliModel,
				context,
				options: { apiKey: cliApiKey, fetch: fetch as typeof globalThis.fetch },
			}),
		);

		expect(events.at(0)?.type).toBe("start");
		expect(events.at(-1)?.type).toBe("done");
		expect(result.content.at(-1)).toMatchObject({ type: "toolCall", name: "lookup" });
		expect(result.usage).toMatchObject({ input: 7, output: 6, cacheRead: 3, totalTokens: 16 });
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it.each([
		["malformed SSE JSON", rawSseResponse("data: {bad json}\n\n"), AI_ERROR_CODES.RESPONSE_VALIDATION_FAILED],
		[
			"malformed Cloud Code wrapper",
			sseResponse([{ response: { candidates: [{ content: { parts: [{ text: 42 }] } }] } }]),
			AI_ERROR_CODES.RESPONSE_VALIDATION_FAILED,
		],
		[
			"missing finishReason",
			sseResponse([{ response: { candidates: [{ content: { parts: [{ text: "open" }] } }] } }]),
			AI_ERROR_CODES.STREAM_PROTOCOL_FAILED,
		],
	] as const)("rejects %s", async (_name, providerResponse, code) => {
		await expectNativeFailure(
			googleGeminiCliAdapter.stream({
				model: cliModel,
				context,
				options: {
					apiKey: cliApiKey,
					fetch: vi.fn(async () => providerResponse.clone()) as typeof globalThis.fetch,
				},
			}),
			code,
		);
	});

	it("maps authentication failures and does not retry non-retryable 4xx responses", async () => {
		const fetch = vi.fn(async () => new Response("unauthorized", { status: 401 }));

		await expectNativeFailure(
			googleGeminiCliAdapter.stream({
				model: cliModel,
				context,
				options: { apiKey: cliApiKey, fetch: fetch as typeof globalThis.fetch },
			}),
			AI_ERROR_CODES.AUTHENTICATION_FAILED,
		);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it("does not start transport for a pre-aborted request", async () => {
		const controller = new AbortController();
		controller.abort();
		const fetch = vi.fn();

		await expectNativeFailure(
			googleGeminiCliAdapter.stream({
				model: cliModel,
				context,
				options: { apiKey: cliApiKey, signal: controller.signal, fetch: fetch as typeof globalThis.fetch },
			}),
			AI_ERROR_CODES.ABORTED,
		);
		expect(fetch).not.toHaveBeenCalled();
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

async function* chunks(values: readonly unknown[], onFirstChunk?: () => void): AsyncIterable<unknown> {
	for (let index = 0; index < values.length; index++) {
		yield values[index];
		if (index === 0) onFirstChunk?.();
	}
}

function successfulChunks(): unknown[] {
	return [
		{
			candidates: [
				{ content: { role: "model", parts: [{ text: "reason", thought: true, thoughtSignature: "thought-sig" }] } },
			],
		},
		{
			candidates: [{ content: { role: "model", parts: [{ text: "hello", thoughtSignature: "text-sig" }] } }],
		},
		{
			candidates: [
				{
					content: {
						role: "model",
						parts: [
							{
								functionCall: { id: "call-1", name: "lookup", args: { query: "test" } },
								thoughtSignature: "tool-sig",
							},
						],
					},
				},
			],
		},
		{
			candidates: [{ finishReason: "STOP" }],
			usageMetadata: {
				promptTokenCount: 10,
				cachedContentTokenCount: 3,
				candidatesTokenCount: 2,
				thoughtsTokenCount: 4,
				totalTokenCount: 16,
			},
		},
	];
}

function sseResponse(values: readonly unknown[]): Response {
	return rawSseResponse(values.map((value) => `data: ${JSON.stringify(value)}\n\n`).join(""));
}

function rawSseResponse(body: string): Response {
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function createModel<TApi extends "google-generative-ai" | "google-gemini-cli" | "google-vertex">(
	api: TApi,
	provider: string,
): Model<TApi> {
	return {
		id: "gemini-2.5-pro",
		name: "Gemini Test",
		api,
		provider,
		baseUrl: "https://provider.test",
		reasoning: true,
		input: ["text"],
		cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};
}
