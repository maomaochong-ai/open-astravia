import { describe, expect, it } from "vitest";
import type { AssistantMessage } from "../src/protocol/index.js";
import { AI_ERROR_CODES, AIError, getAIErrorDetails } from "../src/protocol/index.js";
import {
	AdapterRegistry,
	type ApiProvider,
	ApiProviderRegistrationError,
	LegacyApiProviderRegistry,
} from "../src/runtime/adapter-registry.js";
import { type LanguageModelAdapter, LanguageModelStream } from "../src/runtime/language-model-adapter.js";
import { generateModel, streamModel } from "../src/runtime/stream-model.js";
import { AssistantMessageEventStream } from "../src/utils/event-stream.js";

function provider(api: string): ApiProvider {
	const createStream = () => new AssistantMessageEventStream();
	return { api, stream: createStream, streamSimple: createStream };
}

function adapter(api: string): LanguageModelAdapter {
	return {
		api,
		async stream() {
			const stream = new LanguageModelStream();
			return { events: stream, result: stream.result() };
		},
	};
}

describe("AdapterRegistry", () => {
	it("keeps registrations isolated between instances", () => {
		const first = new AdapterRegistry();
		const second = new AdapterRegistry();

		first.register(adapter("test-api"));

		expect(first.get("test-api")?.api).toBe("test-api");
		expect(second.get("test-api")).toBeUndefined();
	});

	it("rejects duplicate API registrations by default", () => {
		const registry = new AdapterRegistry();
		registry.register(adapter("test-api"), { sourceId: "first" });

		expect(() => registry.register(adapter("test-api"), { sourceId: "second" })).toThrowError(
			expect.objectContaining({
				name: "ApiProviderRegistrationError",
				code: "AI_INVALID_REQUEST",
				metadata: { api: "test-api", existingSourceId: "first", sourceId: "second" },
			}),
		);
	});

	it("allows replacement only when explicitly requested", () => {
		const registry = new AdapterRegistry();
		const original = adapter("test-api");
		const replacement = adapter("test-api");
		registry.register(original, { sourceId: "first" });

		registry.register(replacement, { sourceId: "second", replace: true });

		expect(registry.get("test-api")).toMatchObject({ api: replacement.api });
	});

	it("unregisters only entries owned by a source", () => {
		const registry = new AdapterRegistry();
		registry.register(adapter("first-api"), { sourceId: "extension" });
		registry.register(adapter("second-api"), { sourceId: "built-in" });

		registry.unregisterSource("extension");

		expect(registry.get("first-api")).toBeUndefined();
		expect(registry.get("second-api")).toBeDefined();
	});

	it("rejects a model whose API does not match the adapter", async () => {
		const registry = new AdapterRegistry();
		registry.register(adapter("expected-api"));
		const registeredAdapter = registry.get("expected-api");
		if (!registeredAdapter) throw new Error("Expected adapter");

		await expect(
			registeredAdapter.stream({
				model: {
					id: "model",
					name: "Model",
					api: "other-api",
					provider: "test",
					baseUrl: "https://example.test",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 1000,
					maxTokens: 100,
				},
				context: { messages: [] },
			}),
		).rejects.toMatchObject({ code: "AI_INVALID_REQUEST" });
	});

	it("exposes a dedicated registration error type", () => {
		const error = new ApiProviderRegistrationError("test-api", "first", "second");
		expect(error).toBeInstanceOf(ApiProviderRegistrationError);
	});

	it("keeps the legacy provider registry explicit", () => {
		const registry = new LegacyApiProviderRegistry();
		registry.register(provider("test-api"));

		expect(registry.get("test-api")?.api).toBe("test-api");
	});

	it("normalizes a native response failure at the registry boundary", async () => {
		const registry = new AdapterRegistry();
		const failure = new AIError(AI_ERROR_CODES.RATE_LIMITED, "provider quota exceeded", {
			retryable: true,
			statusCode: 429,
			provider: "test-provider",
			modelId: "model",
		});
		registry.register({
			api: "test-api",
			async stream() {
				const source = new LanguageModelStream();
				source.push({
					type: "error",
					reason: "error",
					error: {
						...assistantErrorMessage("provider quota exceeded"),
						stopReason: "error",
					},
					failure: getAIErrorDetails(failure),
				});
				source.fail(failure);
				return { events: source, result: source.result() };
			},
		});

		const response = await streamModel({ model: testModel(), context: { messages: [] } }, registry);
		const events: string[] = [];
		await expect(
			(async () => {
				for await (const event of response.events) events.push(event.type);
			})(),
		).rejects.toMatchObject({ code: AI_ERROR_CODES.RATE_LIMITED, statusCode: 429 });
		await expect(response.result).rejects.toMatchObject({ code: AI_ERROR_CODES.RATE_LIMITED, statusCode: 429 });
		expect(events).toEqual(["error"]);
	});

	it("normalizes synchronous simple-stream adapter failures", async () => {
		const registry = new AdapterRegistry();
		registry.register({
			api: "test-api",
			async stream() {
				throw Object.assign(new Error("quota exhausted"), { status: 429 });
			},
			async streamSimple() {
				throw Object.assign(new Error("quota exhausted"), { status: 429 });
			},
		});

		await expect(streamModel({ model: testModel(), context: { messages: [] } }, registry)).rejects.toMatchObject({
			code: AI_ERROR_CODES.RATE_LIMITED,
			statusCode: 429,
		});
		const adapter = registry.get("test-api");
		if (!adapter?.streamSimple) throw new Error("Expected simple adapter");
		await expect(adapter.streamSimple({ model: testModel(), context: { messages: [] } })).rejects.toMatchObject({
			code: AI_ERROR_CODES.RATE_LIMITED,
			statusCode: 429,
		});
	});

	it("normalizes native generate and metadata failures", async () => {
		const registry = new AdapterRegistry();
		registry.register({
			api: "test-api",
			async stream() {
				const source = new LanguageModelStream();
				source.push({ type: "done", reason: "stop", message: assistantMessage() });
				return {
					events: source,
					result: source.result(),
					metadata: Promise.reject(Object.assign(new Error("gateway unavailable"), { status: 503 })),
				};
			},
			async generate() {
				return { result: Promise.reject(Object.assign(new Error("gateway unavailable"), { status: 503 })) };
			},
		});

		const streamResponse = await streamModel({ model: testModel(), context: { messages: [] } }, registry);
		await expect(streamResponse.metadata).rejects.toMatchObject({
			code: AI_ERROR_CODES.TRANSPORT_FAILED,
			statusCode: 503,
		});
		const generated = await generateModel({ model: testModel(), context: { messages: [] } }, registry);
		await expect(generated.result).rejects.toMatchObject({
			code: AI_ERROR_CODES.TRANSPORT_FAILED,
			statusCode: 503,
		});
	});
});

function testModel(): Parameters<typeof streamModel>[0]["model"] {
	return {
		id: "model",
		name: "Model",
		api: "test-api",
		provider: "test-provider",
		baseUrl: "https://provider.test",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};
}

function assistantErrorMessage(message: string): AssistantMessage {
	return { ...assistantMessage(), stopReason: "error", errorMessage: message };
}

function assistantMessage(): AssistantMessage {
	return {
		role: "assistant" as const,
		content: [],
		api: "test-api",
		provider: "test-provider",
		model: "model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		timestamp: 1,
	};
}
