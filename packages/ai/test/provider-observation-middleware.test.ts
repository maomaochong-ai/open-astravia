import { describe, expect, it } from "vitest";
import type { AssistantMessage, Context } from "../src/protocol/index.js";
import { AdapterRegistry } from "../src/runtime/adapter-registry.js";
import { type LanguageModelAdapter, LanguageModelStream } from "../src/runtime/language-model-adapter.js";
import { withModelMiddleware } from "../src/runtime/model-middleware.js";
import { createRegistrySimpleStream } from "../src/runtime/registry-simple-stream.js";
import { createProviderObservationMiddleware, type ProviderCallObservation } from "../src/testing/index.js";
import type { Model } from "../src/types.js";

const currentModel: Model<"test-api"> = {
	id: "test-model",
	name: "Test model",
	api: "test-api",
	provider: "test-provider",
	baseUrl: "https://provider.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 10_000,
	maxTokens: 1_000,
};

const context: Context = {
	systemPrompt: "stable instructions",
	systemPromptStableLength: 19,
	messages: [{ role: "user", content: "hello", timestamp: 1 }],
};

function completedMessage(): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: currentModel.api,
		provider: currentModel.provider,
		model: currentModel.id,
		usage: {
			input: 10,
			output: 2,
			cacheRead: 90,
			cacheWrite: 0,
			totalTokens: 102,
			cacheUsageReporting: "read-write",
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 2,
	};
}

function adapter(
	run?: (request: Parameters<LanguageModelAdapter["stream"]>[0]) => Promise<void>,
): LanguageModelAdapter {
	const implementation: LanguageModelAdapter = {
		api: currentModel.api,
		async stream(request) {
			await run?.(request);
			const stream = new LanguageModelStream();
			stream.push({ type: "done", reason: "stop", message: completedMessage() });
			return {
				events: stream,
				result: stream.result(),
				metadata: Promise.resolve({ providerMetadata: { requestId: "request-1" } }),
			};
		},
	};
	return { ...implementation, streamSimple: implementation.stream };
}

async function invoke(
	observations: ProviderCallObservation[],
	capture: "metadata" | "payload" | "wire" = "metadata",
	run?: (request: Parameters<LanguageModelAdapter["stream"]>[0]) => Promise<void>,
): Promise<AssistantMessage> {
	const observed = withModelMiddleware(adapter(run), [
		createProviderObservationMiddleware({
			capture,
			createCallId: () => "call-1",
			now: () => 1_000,
			sink: {
				record(observation) {
					observations.push(observation);
				},
			},
		}),
	]);
	const response = await observed.stream({
		model: currentModel,
		context,
		options: {
			sessionId: "session-1",
			fetch: async () =>
				new Response(JSON.stringify({ access_token: "must-not-leak", result: "ok" }), {
					headers: { "content-type": "application/json" },
				}),
		},
	});
	return response.result;
}

describe("provider observation middleware", () => {
	it("records cache diagnostics and normalized usage without changing the result", async () => {
		const observations: ProviderCallObservation[] = [];

		const result = await invoke(observations);

		expect(result).toEqual(completedMessage());
		expect(observations).toHaveLength(1);
		expect(observations[0]).toMatchObject({
			callId: "call-1",
			capture: "metadata",
			model: { api: "test-api", provider: "test-provider", id: "test-model" },
			sessionId: "session-1",
			request: {
				messageCount: 1,
				promptCache: { stableSystemPromptLength: 19, toolCount: 0 },
			},
			response: {
				stopReason: "stop",
				usage: { input: 10, output: 2, cacheRead: 90, cacheWrite: 0 },
			},
		});
		expect(observations[0]?.request).not.toHaveProperty("payload");
	});

	it("captures provider payloads while redacting credentials", async () => {
		const observations: ProviderCallObservation[] = [];

		await invoke(observations, "payload", async (request) => {
			request.options?.onPayload?.({
				model: "test-model",
				apiKey: "must-not-leak",
				metadata: { access_token: "must-not-leak", trace: "visible" },
			});
		});

		expect(observations[0]?.request.payload).toEqual({
			model: "test-model",
			apiKey: "[REDACTED]",
			metadata: { access_token: "[REDACTED]", trace: "visible" },
		});
	});

	it("captures sanitized HTTP request and response data in explicit wire mode", async () => {
		const observations: ProviderCallObservation[] = [];

		await invoke(observations, "wire", async (request) => {
			await request.options?.fetch?.("https://provider.test/chat?api_key=secret", {
				method: "POST",
				headers: { authorization: "Bearer secret", "x-trace": "visible" },
				body: JSON.stringify({ password: "secret", prompt: "hello" }),
			});
		});

		const wire = observations[0]?.request.wire?.[0];
		expect(wire?.request.url).toContain("api_key=%5BREDACTED%5D");
		expect(wire?.request.headers).toMatchObject({ authorization: "[REDACTED]", "x-trace": "visible" });
		expect(wire?.request.body).toEqual({ password: "[REDACTED]", prompt: "hello" });
		expect(wire?.response?.body).toEqual({ access_token: "[REDACTED]", result: "ok" });
	});

	it("does not fail the model call when the observation sink fails", async () => {
		const observed = withModelMiddleware(adapter(), [
			createProviderObservationMiddleware({
				sink: {
					record() {
						throw new Error("disk unavailable");
					},
				},
			}),
		]);

		const response = await observed.stream({ model: currentModel, context });
		await expect(response.result).resolves.toEqual(completedMessage());
	});

	it("runs through an isolated Adapter Registry simple-stream entry", async () => {
		const observations: ProviderCallObservation[] = [];
		const registry = new AdapterRegistry();
		registry.register(adapter(), {
			middleware: [
				createProviderObservationMiddleware({
					sink: {
						record(observation) {
							observations.push(observation);
						},
					},
				}),
			],
		});
		const events = createRegistrySimpleStream(registry)(currentModel, context);

		for await (const _event of events) {
			// Consuming the compatibility stream completes the observed native call.
		}

		expect(observations).toHaveLength(1);
	});
});
