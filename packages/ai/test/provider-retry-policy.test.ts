import { afterEach, describe, expect, it, vi } from "vitest";
import { createBedrockClient } from "../src/providers/amazon-bedrock/client.js";
import { createAnthropicClient } from "../src/providers/anthropic/client.js";
import { createAzureOpenAIResponsesClient } from "../src/providers/azure-openai-responses/request.js";
import { createGoogleClient } from "../src/providers/google/client.js";
import { fetchGoogleCloudCodeResponse } from "../src/providers/google-gemini-cli/retry.js";
import { fetchCodexResponse } from "../src/providers/openai-codex/request.js";
import { createOpenAICompletionsClient } from "../src/providers/openai-completions/request.js";
import { createOpenAIResponsesClient } from "../src/providers/openai-responses/request.js";
import type { Model } from "../src/types.js";

const modelDefaults = {
	id: "test-model",
	name: "Test model",
	provider: "test-provider",
	baseUrl: "https://provider.test/v1",
	reasoning: false,
	input: ["text"] as Array<"text" | "image">,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_000,
};

const completionsModel: Model<"openai-completions"> = { ...modelDefaults, api: "openai-completions" };

const responsesModel: Model<"openai-responses"> = { ...modelDefaults, api: "openai-responses" };

const anthropicModel: Model<"anthropic-messages"> = { ...modelDefaults, api: "anthropic-messages" };

const azureResponsesModel: Model<"azure-openai-responses"> = {
	...modelDefaults,
	api: "azure-openai-responses",
};

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("provider retry ownership", () => {
	it("disables SDK retries by default while preserving explicit opt-in", async () => {
		const context = { messages: [{ role: "user" as const, content: "hello", timestamp: 1 }] };

		expect(createOpenAIResponsesClient(responsesModel, context, "key").maxRetries).toBe(0);
		expect(createOpenAIResponsesClient(responsesModel, context, "key", { maxRetries: 2 }).maxRetries).toBe(2);
		expect(createOpenAICompletionsClient(completionsModel, context, "key").maxRetries).toBe(0);
		expect(createOpenAICompletionsClient(completionsModel, context, "key", undefined, undefined, 2).maxRetries).toBe(
			2,
		);
		expect(createAnthropicClient(anthropicModel, "key", false).client.maxRetries).toBe(0);
		expect(
			createAnthropicClient(anthropicModel, "key", false, undefined, undefined, undefined, 2).client.maxRetries,
		).toBe(2);
		expect(createAzureOpenAIResponsesClient(azureResponsesModel, "key").maxRetries).toBe(0);
		expect(createAzureOpenAIResponsesClient(azureResponsesModel, "key", { maxRetries: 2 }).maxRetries).toBe(2);

		const bedrock = await createBedrockClient({ region: "us-east-1" });
		const optedInBedrock = await createBedrockClient({ region: "us-east-1", maxRetries: 2 });
		expect(await bedrock.config.maxAttempts()).toBe(1);
		expect(await optedInBedrock.config.maxAttempts()).toBe(3);
	});

	it("surfaces retryable Codex and Gemini CLI failures after one request by default", async () => {
		const codexFetch = vi.fn(
			async () =>
				new Response("overloaded", { status: 503, headers: { "Retry-After": "2", "X-Request-Id": "codex-1" } }),
		);
		await expect(
			fetchCodexResponse("https://provider.test", new Headers(), "{}", undefined, codexFetch),
		).rejects.toMatchObject({ status: 503, responseHeaders: expect.any(Headers) });
		expect(codexFetch).toHaveBeenCalledTimes(1);

		const geminiFetch = vi.fn(
			async () =>
				new Response("overloaded", { status: 503, headers: { "Retry-After": "3", "X-Request-Id": "gemini-1" } }),
		);
		await expect(
			fetchGoogleCloudCodeResponse(["https://provider.test"], {}, "{}", { fetch: geminiFetch }),
		).rejects.toMatchObject({ status: 503, responseHeaders: expect.any(Headers) });
		expect(geminiFetch).toHaveBeenCalledTimes(1);
	});

	it("configures the native Google SDK for one attempt by default", async () => {
		const googleFetch = vi.fn(async () => new Response('{"error":{"message":"overloaded"}}', { status: 503 }));
		vi.stubGlobal("fetch", googleFetch);
		const client = createGoogleClient({
			model: {
				...modelDefaults,
				api: "google-generative-ai",
				baseUrl: "https://provider.test",
			},
			context: { messages: [] },
			options: { apiKey: "key" },
		});

		await expect(
			client.models.generateContentStream({ model: "test-model", contents: "hello" }),
		).rejects.toBeInstanceOf(Error);
		expect(googleFetch).toHaveBeenCalledTimes(1);
	});

	it("rejects invalid retry counts before sending a request", () => {
		expect(() => createOpenAIResponsesClient(responsesModel, { messages: [] }, "key", { maxRetries: -1 })).toThrow(
			"maxRetries must be a non-negative safe integer",
		);
	});
});
