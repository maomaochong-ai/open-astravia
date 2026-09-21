import { afterEach, describe, expect, it, vi } from "vitest";
import { setProviderFetchResolver, supportsProviderFetchInjection, withProviderFetch } from "../src/provider-fetch.js";
import { getDefaultAdapterRegistry } from "../src/runtime/default-adapter-registry.js";
import { LanguageModelStream } from "../src/runtime/language-model-adapter.js";
import { streamSimple } from "../src/stream.js";
import type { Api, AssistantMessage, FetchFunction, Model, StreamOptions } from "../src/types.js";

function testModel(overrides: Partial<Model<Api>> = {}): Model<Api> {
	return {
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
		...overrides,
	};
}

function doneMessage(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		api: model.api,
		provider: model.provider,
		model: model.id,
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

/**
 * 替换内置 openai-completions 适配器，捕获它真正收到的 options，
 * 以此证明注入发生在公共入口而不是只发生在辅助函数里。
 */
async function captureStreamSimpleOptions(
	model: Model<Api>,
	options?: StreamOptions,
): Promise<StreamOptions | undefined> {
	const registry = getDefaultAdapterRegistry();
	const original = registry.get("openai-completions");
	if (!original) throw new Error("Expected built-in OpenAI adapter");
	let seen: StreamOptions | undefined;

	registry.register(
		{
			api: "openai-completions",
			async stream(request) {
				seen = request.options;
				const events = new LanguageModelStream();
				events.push({ type: "done", reason: "stop", message: doneMessage(model) });
				return { events, result: events.result() };
			},
			async streamSimple(request) {
				seen = request.options;
				const events = new LanguageModelStream();
				events.push({ type: "done", reason: "stop", message: doneMessage(model) });
				return { events, result: events.result() };
			},
		},
		{ replace: true, sourceId: "provider-fetch-test" },
	);

	try {
		await streamSimple(model, { messages: [] }, options).result();
		return seen;
	} finally {
		registry.register(original, { replace: true, sourceId: "built-in" });
	}
}

afterEach(() => {
	setProviderFetchResolver(undefined);
});

describe("provider fetch resolver", () => {
	it("injects the host transport into requests made through the public entry point", async () => {
		const proxyFetch = vi.fn() as unknown as FetchFunction;
		setProviderFetchResolver((model) => (model.provider === "test-provider" ? proxyFetch : undefined));

		const seen = await captureStreamSimpleOptions(testModel());

		expect(seen?.fetch).toBe(proxyFetch);
	});

	it("leaves a provider the resolver declines on the default transport", async () => {
		setProviderFetchResolver(() => undefined);

		const seen = await captureStreamSimpleOptions(testModel());

		expect(seen?.fetch).toBeUndefined();
	});

	it("keeps an explicitly supplied fetch, so tests and callers still win", async () => {
		const explicit = vi.fn() as unknown as FetchFunction;
		const proxyFetch = vi.fn() as unknown as FetchFunction;
		setProviderFetchResolver(() => proxyFetch);

		const seen = await captureStreamSimpleOptions(testModel(), { fetch: explicit });

		expect(seen?.fetch).toBe(explicit);
	});

	it("does not fabricate options when nothing needs injecting", () => {
		expect(withProviderFetch(testModel(), undefined)).toBeUndefined();
	});
});

describe("supportsProviderFetchInjection", () => {
	it("flags the vendor-SDK APIs that cannot honour an injected fetch", () => {
		expect(supportsProviderFetchInjection("bedrock-converse-stream")).toBe(false);
		expect(supportsProviderFetchInjection("google-generative-ai")).toBe(false);
		expect(supportsProviderFetchInjection("google-vertex")).toBe(false);
	});

	it("accepts the APIs whose adapters thread options.fetch", () => {
		for (const api of [
			"anthropic-messages",
			"openai-completions",
			"openai-responses",
			"azure-openai-responses",
			"openai-codex-responses",
			"google-gemini-cli",
		] as const) {
			expect(supportsProviderFetchInjection(api)).toBe(true);
		}
	});
});
