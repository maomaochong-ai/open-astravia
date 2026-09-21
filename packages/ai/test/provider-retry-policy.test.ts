import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeProviderError } from "../src/provider-kit/index.js";
import { createBedrockClient } from "../src/providers/amazon-bedrock/client.js";
import { createAnthropicClient } from "../src/providers/anthropic/client.js";
import { createAzureOpenAIResponsesClient } from "../src/providers/azure-openai-responses/request.js";
import { createGoogleClient } from "../src/providers/google/client.js";
import { fetchGoogleCloudCodeResponse } from "../src/providers/google-gemini-cli/retry.js";
import { sendGoogleSdkRequestWithRetries } from "../src/providers/google-stream/retry.js";
import { createGoogleVertexClient } from "../src/providers/google-vertex/client.js";
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
		const responseBody = JSON.stringify({
			error: {
				message: "No capacity available for model test-model",
				code: "MODEL_CAPACITY_EXHAUSTED",
			},
		});
		const codexFetch = vi.fn(
			async () =>
				new Response(responseBody, {
					status: 503,
					headers: { "Retry-After": "2", "X-Request-Id": "codex-1" },
				}),
		);
		let codexError: unknown;
		try {
			await fetchCodexResponse("https://provider.test", new Headers(), "{}", undefined, codexFetch);
		} catch (error) {
			codexError = error;
		}
		expect(normalizeProviderError(codexError, responsesModel)).toMatchObject({
			message: "No capacity available for model test-model",
			statusCode: 503,
			providerCode: "MODEL_CAPACITY_EXHAUSTED",
			responseBodyPreview: responseBody,
		});
		expect(codexFetch).toHaveBeenCalledTimes(1);

		const geminiFetch = vi.fn(
			async () =>
				new Response(responseBody, {
					status: 503,
					headers: { "Retry-After": "3", "X-Request-Id": "gemini-1" },
				}),
		);
		let geminiError: unknown;
		try {
			await fetchGoogleCloudCodeResponse(["https://provider.test"], {}, "{}", { fetch: geminiFetch });
		} catch (error) {
			geminiError = error;
		}
		expect(normalizeProviderError(geminiError, { ...modelDefaults, api: "google-gemini-cli" })).toMatchObject({
			message: "No capacity available for model test-model",
			statusCode: 503,
			providerCode: "MODEL_CAPACITY_EXHAUSTED",
			responseBodyPreview: responseBody,
		});
		expect(geminiFetch).toHaveBeenCalledTimes(1);
	});

	it("preserves the native Google error body after one request by default", async () => {
		const responseBody = {
			error: {
				code: 503,
				message: "No capacity available for model gpt-oss-120b-medium",
				status: "UNAVAILABLE",
				details: [{ reason: "MODEL_CAPACITY_EXHAUSTED" }],
			},
		};
		const googleFetch = vi.fn(
			async () =>
				new Response(JSON.stringify(responseBody), {
					status: 503,
					statusText: "Service Unavailable",
				}),
		);
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

		let source: unknown;
		try {
			await client.models.generateContentStream({ model: "test-model", contents: "hello" });
		} catch (error) {
			source = error;
		}

		expect(source).toBeInstanceOf(Error);
		expect(normalizeProviderError(source, { ...modelDefaults, api: "google-generative-ai" })).toMatchObject({
			code: "AI_TRANSPORT_FAILED",
			message: "No capacity available for model gpt-oss-120b-medium",
			statusCode: 503,
			providerCode: "MODEL_CAPACITY_EXHAUSTED",
			retryable: true,
		});
		expect(googleFetch).toHaveBeenCalledTimes(1);
	});

	it("leaves native Google and Vertex retry wrappers disabled for the default single attempt", () => {
		const googleClient = createGoogleClient({
			model: { ...modelDefaults, api: "google-generative-ai" },
			context: { messages: [] },
			options: { apiKey: "key" },
		});
		const vertexClient = createGoogleVertexClient({
			model: { ...modelDefaults, api: "google-vertex" },
			context: { messages: [] },
			options: { project: "test-project", location: "us-central1" },
		});
		const clientOptions = (client: unknown) => client as { httpOptions?: { retryOptions?: { attempts: number } } };

		expect(clientOptions(googleClient).httpOptions?.retryOptions).toBeUndefined();
		expect(clientOptions(vertexClient).httpOptions?.retryOptions).toBeUndefined();
	});

	it("retries Google outside the SDK and preserves the terminal provider error", async () => {
		const source = Object.assign(
			new Error(
				JSON.stringify({
					error: {
						code: 503,
						message: "No capacity available for model test-model",
						details: [{ reason: "MODEL_CAPACITY_EXHAUSTED" }],
					},
				}),
			),
			{ status: 503 },
		);
		const operation = vi.fn(async () => {
			throw source;
		});
		const sleep = vi.fn(async () => undefined);
		const request = {
			model: { ...modelDefaults, api: "google-generative-ai" as const },
			context: { messages: [] },
			options: { apiKey: "key", maxRetries: 1 },
		};

		await expect(sendGoogleSdkRequestWithRetries(operation, request, sleep)).rejects.toBe(source);
		expect(operation).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenCalledTimes(1);
		expect(normalizeProviderError(source, request.model)).toMatchObject({
			message: "No capacity available for model test-model",
			statusCode: 503,
			providerCode: "MODEL_CAPACITY_EXHAUSTED",
		});
	});

	it("rejects invalid retry counts before sending a request", () => {
		expect(() => createOpenAIResponsesClient(responsesModel, { messages: [] }, "key", { maxRetries: -1 })).toThrow(
			"maxRetries must be a non-negative safe integer",
		);
	});
});
