import { describe, expect, it } from "vitest";
import {
	AdapterRegistry,
	type ApiProvider,
	ApiProviderRegistrationError,
	LegacyApiProviderRegistry,
} from "../src/runtime/adapter-registry.js";
import { type LanguageModelAdapter, LanguageModelStream } from "../src/runtime/language-model-adapter.js";
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
});
