import { describe, expect, it } from "vitest";
import type { ApiProvider } from "../src/runtime/adapter-registry.js";
import { adaptApiProvider, adaptLegacyAssistantMessageStream } from "../src/runtime/language-model-adapter.js";
import type { Api, AssistantMessage, AssistantMessageEvent, Context, Model } from "../src/types.js";
import { AssistantMessageEventStream } from "../src/utils/event-stream.js";

const model: Model<Api> = {
	id: "test-model",
	name: "Test Model",
	api: "test-api",
	provider: "test-provider",
	baseUrl: "https://provider.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
};

const context: Context = { messages: [] };

describe("adaptApiProvider", () => {
	it("exposes the compatibility stream projection without a registry wrapper", async () => {
		const result = message("stop");
		const response = adaptLegacyAssistantMessageStream(
			createCompatibilityStream([
				{ type: "start", partial: result },
				{ type: "done", reason: "stop", message: result },
			]),
			model,
		);

		await expect(response.result).resolves.toBe(result);
	});

	it("forwards successful events and resolves the final result", async () => {
		const result = message("stop");
		const adapter = adaptApiProvider(
			provider([
				{ type: "start", partial: result },
				{ type: "done", reason: "stop", message: result },
			]),
		);
		const response = await adapter.stream({ model, context });
		const eventTypes: string[] = [];

		for await (const event of response.events) eventTypes.push(event.type);

		expect(eventTypes).toEqual(["start", "done"]);
		await expect(response.result).resolves.toBe(result);
	});

	it.each([
		["ordinary provider failure", message("error", "provider unavailable"), "AI_TRANSPORT_FAILED"],
		["context overflow", message("error", "prompt is too long: 1200 tokens > 1000 maximum"), "AI_CONTEXT_OVERFLOW"],
		["aborted request", message("aborted", "request aborted"), "AI_ABORTED"],
	] as const)("turns a compatibility error terminal into a rejected %s", async (_name, result, code) => {
		const reason = result.stopReason === "aborted" ? "aborted" : "error";
		const adapter = adaptApiProvider(provider([{ type: "error", reason, error: result }]));
		const response = await adapter.stream({ model, context });

		await expect(consume(response.events)).rejects.toMatchObject({ code });
		await expect(response.result).rejects.toMatchObject({ code });
	});

	it.each([
		["401 unauthorized", "AI_AUTHENTICATION_FAILED", false],
		["403 forbidden", "AI_PERMISSION_DENIED", false],
		["429 too many requests", "AI_RATE_LIMITED", true],
		["400 invalid request", "AI_INVALID_REQUEST", false],
		["503 unavailable", "AI_TRANSPORT_FAILED", true],
	] as const)("classifies legacy HTTP errors: %s", async (errorMessage, code, retryable) => {
		const result = message("error", errorMessage);
		const adapter = adaptApiProvider(provider([{ type: "error", reason: "error", error: result }]));
		const response = await adapter.stream({ model, context });

		await expect(response.result).rejects.toMatchObject({ code, retryable });
	});

	it("normalizes a lower-level stream failure", async () => {
		const source = new AssistantMessageEventStream();
		const legacy = providerFromStream(source);
		const response = await adaptApiProvider(legacy).stream({ model, context });

		source.fail(new Error("socket closed"));

		await expect(consume(response.events)).rejects.toMatchObject({
			code: "AI_TRANSPORT_FAILED",
			message: "socket closed",
			provider: "test-provider",
			modelId: "test-model",
		});
	});
});

function provider(events: readonly AssistantMessageEvent[]): ApiProvider {
	return providerFromStream(createCompatibilityStream(events));
}

function providerFromStream(stream: AssistantMessageEventStream): ApiProvider {
	return {
		api: "test-api",
		stream: () => stream,
		streamSimple: () => stream,
	};
}

function createCompatibilityStream(events: readonly AssistantMessageEvent[]): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();
	for (const event of events) stream.push(event);
	return stream;
}

function message(stopReason: "stop" | "error" | "aborted", errorMessage?: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "test-api",
		provider: "test-provider",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		errorMessage,
		timestamp: 1,
	};
}

async function consume(stream: AsyncIterable<unknown>): Promise<void> {
	for await (const _event of stream) {
		// Drain the stream to observe its terminal contract.
	}
}
