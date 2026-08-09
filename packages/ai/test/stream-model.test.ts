import { describe, expect, it } from "vitest";
import { AdapterRegistry } from "../src/runtime/adapter-registry.js";
import { getDefaultAdapterRegistry } from "../src/runtime/default-adapter-registry.js";
import { LanguageModelStream } from "../src/runtime/language-model-adapter.js";
import { collectResponse, streamModel } from "../src/runtime/stream-model.js";
import type { Api, AssistantMessage, Model } from "../src/types.js";

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

describe("streamModel", () => {
	it("registers every built-in API in the default registry", () => {
		expect(
			getDefaultAdapterRegistry()
				.getAll()
				.map((adapter) => adapter.api),
		).toEqual([
			"anthropic-messages",
			"openai-completions",
			"openai-responses",
			"azure-openai-responses",
			"openai-codex-responses",
			"google-generative-ai",
			"google-gemini-cli",
			"google-vertex",
			"nvidia-openai-responses",
			"qwen-openai-completions",
			"openai-completions-deepseek",
			"zai-openai-completions",
			"zhipu-openai-completions",
			"bedrock-converse-stream",
		]);
	});

	it("streams through an isolated registry and collects the response", async () => {
		const registry = new AdapterRegistry();
		const result = assistantMessage();
		registry.register({
			api: "test-api",
			async stream() {
				const stream = new LanguageModelStream();
				stream.push({ type: "done", reason: "stop", message: result });
				return { events: stream, result: stream.result() };
			},
		});

		const response = await streamModel({ model, context: { messages: [] } }, registry);

		await expect(collectResponse(response)).resolves.toBe(result);
	});

	it("rejects an API without a registered adapter", async () => {
		await expect(streamModel({ model, context: { messages: [] } }, new AdapterRegistry())).rejects.toMatchObject({
			code: "AI_UNSUPPORTED_CAPABILITY",
			metadata: { api: "test-api" },
		});
	});
});

function assistantMessage(): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
}
