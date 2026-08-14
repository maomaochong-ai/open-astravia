import { describe, expect, it } from "vitest";
import { registerApiProvider, unregisterApiProviders } from "../src/api-registry.js";
import { getDefaultAdapterRegistry } from "../src/runtime/default-adapter-registry.js";
import { LanguageModelStream } from "../src/runtime/language-model-adapter.js";
import { stream, streamSimple } from "../src/stream.js";
import type { Api, AssistantMessage, Model } from "../src/types.js";

const testModel: Model<Api> = {
	id: "test-model",
	name: "Test Model",
	api: "openai-completions",
	provider: "test-provider",
	baseUrl: "https://provider.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
};

function message(): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "native" }],
		api: testModel.api,
		provider: testModel.provider,
		model: testModel.id,
		usage: {
			input: 0,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 1,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
}

describe("public stream native preference", () => {
	it("uses the native adapter before a legacy provider with the same API", async () => {
		const registry = getDefaultAdapterRegistry();
		const original = registry.get("openai-completions");
		if (!original) throw new Error("Expected built-in OpenAI adapter");

		registry.register(
			{
				api: "openai-completions",
				async stream() {
					const nativeStream = new LanguageModelStream();
					nativeStream.push({ type: "done", reason: "stop", message: message() });
					return { events: nativeStream, result: nativeStream.result() };
				},
			},
			{ replace: true, sourceId: "native-preference-test" },
		);

		try {
			const response = stream(testModel, { messages: [] });
			const events = [];
			for await (const event of response) events.push(event);
			expect(events.at(-1)?.type).toBe("done");
			expect((await response.result()).content).toEqual([{ type: "text", text: "native" }]);
		} finally {
			unregisterApiProviders("native-preference-test");
			registry.register(original, { replace: true, sourceId: "built-in" });
		}
	});

	it("keeps an extension legacy provider as an explicit override", async () => {
		const registry = getDefaultAdapterRegistry();
		const original = registry.get("openai-completions");
		if (!original) throw new Error("Expected built-in OpenAI adapter");

		registerApiProvider(
			{
				api: "openai-completions",
				stream() {
					const legacyStream = new (class extends LanguageModelStream {})();
					legacyStream.push({
						type: "done",
						reason: "stop",
						message: { ...message(), content: [{ type: "text", text: "legacy" }] },
					});
					return legacyStream;
				},
				streamSimple() {
					throw new Error("unused");
				},
			},
			"extension-override-test",
		);

		try {
			const response = stream(testModel, { messages: [] });
			expect((await response.result()).content).toEqual([{ type: "text", text: "legacy" }]);
		} finally {
			unregisterApiProviders("extension-override-test");
			registry.register(original, { replace: true, sourceId: "built-in" });
		}
	});

	it("uses a native simple-stream adapter before a built-in legacy provider", async () => {
		const registry = getDefaultAdapterRegistry();
		const original = registry.get("openai-completions");
		if (!original) throw new Error("Expected built-in OpenAI adapter");

		registry.register(
			{
				api: "openai-completions",
				async stream() {
					throw new Error("unused");
				},
				async streamSimple() {
					const nativeStream = new LanguageModelStream();
					nativeStream.push({ type: "done", reason: "stop", message: message() });
					return { events: nativeStream, result: nativeStream.result() };
				},
			},
			{ replace: true, sourceId: "native-simple-preference-test" },
		);

		try {
			const response = streamSimple(testModel, { messages: [] });
			expect((await response.result()).content).toEqual([{ type: "text", text: "native" }]);
		} finally {
			unregisterApiProviders("native-simple-preference-test");
			registry.register(original, { replace: true, sourceId: "built-in" });
		}
	});
});
