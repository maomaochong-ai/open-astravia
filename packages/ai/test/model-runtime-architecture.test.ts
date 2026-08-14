import { describe, expect, it } from "vitest";
import { AI_ERROR_CODES, AIError, type AssistantMessage, getAIErrorDetails } from "../src/protocol/index.js";
import { AdapterRegistry } from "../src/runtime/adapter-registry.js";
import { type LanguageModelAdapter, LanguageModelStream } from "../src/runtime/language-model-adapter.js";
import { collectModelCallResult } from "../src/runtime/model-call-result.js";
import { resolveEffectiveModelCapabilities } from "../src/runtime/model-capabilities.js";
import { resolveModel } from "../src/runtime/model-identity.js";
import { type ModelMiddleware, withModelMiddleware } from "../src/runtime/model-middleware.js";
import { ModelRouter } from "../src/runtime/model-router.js";
import type { Model } from "../src/types.js";

function model(api = "test-api", id = "test-model"): Model<typeof api> {
	return {
		id,
		name: id,
		api,
		provider: "test-provider",
		baseUrl: "https://provider.test",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};
}

function message(currentModel: Model<string>, text = "ok"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: currentModel.api,
		provider: currentModel.provider,
		model: currentModel.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
}

function adapterFor(currentModel: Model<string>, failure?: unknown): LanguageModelAdapter {
	return {
		api: currentModel.api,
		async stream() {
			if (failure) throw failure;
			const stream = new LanguageModelStream();
			stream.push({ type: "done", reason: "stop", message: message(currentModel) });
			return { events: stream, result: stream.result() };
		},
	};
}

describe("model runtime architecture", () => {
	it("normalizes a stream result without losing provider metadata", async () => {
		const currentModel = model();
		const stream = new LanguageModelStream();
		stream.push({ type: "done", reason: "length", message: { ...message(currentModel), stopReason: "length" } });
		const result = await collectModelCallResult({
			result: stream.result(),
			metadata: Promise.resolve({
				finishReason: { unified: "length", raw: "max_tokens" },
				warnings: [{ message: "provider warning" }],
				providerMetadata: { trace: "trace-1" },
			}),
		});
		expect(result.finishReason).toEqual({ unified: "length", raw: "max_tokens" });
		expect(result.warnings).toEqual([{ message: "provider warning" }]);
		expect(result.providerMetadata).toEqual({ trace: "trace-1" });
	});

	it("resolves identity and explicit capabilities separately from endpoint data", () => {
		const currentModel = model();
		const resolved = resolveModel(currentModel);
		expect(resolved.identity).toMatchObject({ api: "test-api", provider: "test-provider", modelId: "test-model" });
		expect(resolved.endpoint.baseUrl).toBe("https://provider.test");
		expect(resolved.capabilities).toMatchObject({ streaming: true, tools: true, input: ["text"] });
	});

	it("treats adapter capabilities as an upper bound for model capabilities", () => {
		const currentModel = {
			...model(),
			capabilities: {
				streaming: true,
				tools: true,
				structuredOutput: true,
				reasoning: true,
				parallelToolCalls: true,
				input: ["text"] as const,
			},
		};
		const capabilities = resolveEffectiveModelCapabilities(currentModel, {
			structuredOutput: false,
			parallelToolCalls: false,
			input: ["text"],
		});
		expect(capabilities).toMatchObject({ structuredOutput: false, parallelToolCalls: false, input: ["text"] });
	});

	it("runs middleware in deterministic transform and wrapper order", async () => {
		const currentModel = model();
		const calls: string[] = [];
		const middleware: ModelMiddleware[] = [
			{
				name: "outer",
				transformRequest(request) {
					calls.push("transform:outer");
					return request;
				},
				async wrapStream(request, next) {
					calls.push("before:outer");
					const response = await next(request);
					calls.push("after:outer");
					return response;
				},
			},
			{
				name: "inner",
				transformRequest(request) {
					calls.push("transform:inner");
					return request;
				},
				async wrapStream(request, next) {
					calls.push("before:inner");
					const response = await next(request);
					calls.push("after:inner");
					return response;
				},
			},
		];
		const response = await withModelMiddleware(adapterFor(currentModel), middleware).stream({
			model: currentModel,
			context: { messages: [] },
		});
		await response.result;
		expect(calls).toEqual([
			"transform:outer",
			"transform:inner",
			"before:outer",
			"before:inner",
			"after:inner",
			"after:outer",
		]);
	});

	it("preserves adapter capabilities and applies middleware to simple streams", async () => {
		const currentModel = model();
		const calls: string[] = [];
		const adapter: LanguageModelAdapter = {
			api: currentModel.api,
			capabilities: { tools: true, structuredOutput: false },
			async stream() {
				throw new Error("unused");
			},
			async streamSimple() {
				calls.push("adapter");
				const stream = new LanguageModelStream();
				stream.push({ type: "done", reason: "stop", message: message(currentModel) });
				return { events: stream, result: stream.result() };
			},
		};
		const decorated = withModelMiddleware(adapter, [
			{
				name: "simple-observer",
				transformRequest(request) {
					calls.push("transform");
					return request;
				},
				async wrapStreamSimple(request, next) {
					calls.push("before");
					const response = await next(request);
					calls.push("after");
					return response;
				},
			},
		]);

		expect(decorated.capabilities).toEqual({ tools: true, structuredOutput: false });
		if (!decorated.streamSimple) throw new Error("Expected streamSimple to be preserved");
		const response = await decorated.streamSimple({ model: currentModel, context: { messages: [] } });
		await response.result;
		expect(calls).toEqual(["transform", "before", "adapter", "after"]);
	});

	it("falls back only for configured structured errors before a stream starts", async () => {
		const first = model("first-api", "first");
		const second = model("second-api", "second");
		const registry = new AdapterRegistry();
		registry.register(adapterFor(first, new AIError(AI_ERROR_CODES.RATE_LIMITED, "limited", { retryable: true })));
		registry.register(adapterFor(second));
		const result = await new ModelRouter(registry).stream(
			{ model: first, context: { messages: [] } },
			[{ model: second }],
			{ fallbackCodes: [AI_ERROR_CODES.RATE_LIMITED] },
		);
		expect(result.model.id).toBe("second");
	});

	it("falls back when a structured provider failure arrives after start but before model output", async () => {
		const first = model("first-api", "first");
		const second = model("second-api", "second");
		const failure = new AIError(AI_ERROR_CODES.RATE_LIMITED, "limited", { retryable: true });
		const firstAdapter: LanguageModelAdapter = {
			api: first.api,
			async stream() {
				const stream = new LanguageModelStream();
				stream.push({ type: "start", partial: message(first, "") });
				stream.push({
					type: "error",
					reason: "error",
					error: { ...message(first, "limited"), stopReason: "error", errorMessage: "limited" },
					failure: getAIErrorDetails(failure),
				});
				stream.fail(failure);
				return { events: stream, result: stream.result() };
			},
		};
		const registry = new AdapterRegistry();
		registry.register(firstAdapter);
		registry.register(adapterFor(second));

		const routed = await new ModelRouter(registry).stream(
			{ model: first, context: { messages: [] } },
			[{ model: second }],
			{ fallbackCodes: [AI_ERROR_CODES.RATE_LIMITED] },
		);
		const events: string[] = [];
		for await (const event of routed.response.events) events.push(event.type);

		expect(routed.model.id).toBe("second");
		expect(events).toEqual(["done"]);
		expect(await routed.response.result).toMatchObject({ model: "second" });
	});

	it("never falls back after the first model output event", async () => {
		const first = model("first-api", "first");
		const second = model("second-api", "second");
		const failure = new AIError(AI_ERROR_CODES.RATE_LIMITED, "limited", { retryable: true });
		let secondCalls = 0;
		const registry = new AdapterRegistry();
		registry.register({
			api: first.api,
			async stream() {
				const stream = new LanguageModelStream();
				stream.push({ type: "start", partial: message(first, "") });
				stream.push({ type: "text_start", contentIndex: 0, partial: message(first, "") });
				queueMicrotask(() => {
					stream.push({
						type: "error",
						reason: "error",
						error: { ...message(first, "limited"), stopReason: "error", errorMessage: "limited" },
						failure: getAIErrorDetails(failure),
					});
					stream.fail(failure);
				});
				return { events: stream, result: stream.result() };
			},
		});
		registry.register({
			...adapterFor(second),
			async stream(request) {
				secondCalls += 1;
				return adapterFor(second).stream(request);
			},
		});

		const routed = await new ModelRouter(registry).stream(
			{ model: first, context: { messages: [] } },
			[{ model: second }],
			{ fallbackCodes: [AI_ERROR_CODES.RATE_LIMITED] },
		);
		const eventTypes: string[] = [];
		await expect(
			(async () => {
				for await (const event of routed.response.events) eventTypes.push(event.type);
			})(),
		).rejects.toMatchObject({ code: AI_ERROR_CODES.RATE_LIMITED });

		expect(routed.model.id).toBe("first");
		expect(secondCalls).toBe(0);
		expect(eventTypes).toEqual(["start", "text_start", "error"]);
	});

	it("fails a terminal-less route without waiting for the provider result promise", async () => {
		const currentModel = model();
		const registry = new AdapterRegistry();
		registry.register({
			api: currentModel.api,
			async stream() {
				return {
					events: {
						[Symbol.asyncIterator]() {
							return {
								async next() {
									return { done: true as const, value: undefined };
								},
							};
						},
					},
					result: new Promise(() => undefined),
				};
			},
		});

		const routed = new ModelRouter(registry).stream({ model: currentModel, context: { messages: [] } });
		await expect(routed).rejects.toMatchObject({ code: AI_ERROR_CODES.STREAM_PROTOCOL_FAILED });
	});

	it("fails a committed terminal-less route instead of hanging the response result", async () => {
		const currentModel = model();
		const registry = new AdapterRegistry();
		registry.register({
			api: currentModel.api,
			async stream() {
				return {
					events: {
						async *[Symbol.asyncIterator]() {
							yield { type: "start", partial: message(currentModel, "") };
							yield { type: "text_start", contentIndex: 0, partial: message(currentModel, "") };
							return;
						},
					},
					result: new Promise(() => undefined),
				};
			},
		});

		const routed = await new ModelRouter(registry).stream({ model: currentModel, context: { messages: [] } });
		const eventTypes: string[] = [];
		await expect(
			(async () => {
				for await (const event of routed.response.events) eventTypes.push(event.type);
			})(),
		).rejects.toMatchObject({ code: AI_ERROR_CODES.STREAM_PROTOCOL_FAILED });
		await expect(routed.response.result).rejects.toMatchObject({ code: AI_ERROR_CODES.STREAM_PROTOCOL_FAILED });
		expect(eventTypes).toEqual(["start", "text_start", "error"]);
	});
});
