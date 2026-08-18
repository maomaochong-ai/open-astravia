import { AI_ERROR_CODES, AIError, AssistantMessageEventStream, type Model, type SimpleStreamFunction } from "@vetta/ai";
import { describe, expect, it, vi } from "vitest";
import { createProviderDebugDefinitions } from "./definitions.js";
import { type ProviderPreflightDependencies, type ProviderPreflightError, runProviderPreflight } from "./preflight.js";

const model: Model<"test-api"> = {
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

function createDependencies(
	streamFn: SimpleStreamFunction = successfulStream,
	overrides: Partial<ProviderPreflightDependencies["models"]> = {},
): ProviderPreflightDependencies {
	return {
		models: {
			find: () => model,
			getApiKey: async () => "test-secret",
			getAvailable: () => [model],
			isRemote: () => false,
			isUsingOAuth: () => false,
			loadRemoteModels: async () => undefined,
			...overrides,
		},
		streamFn,
		now: () => 1_000,
	};
}

function successfulStream(
	_model: Model<string>,
	_context: unknown,
	_options?: { cacheRetention?: string; maxTokens?: number },
) {
	const stream = new AssistantMessageEventStream();
	stream.push({
		type: "done",
		reason: "stop",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "OK" }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 3,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 4,
				cacheUsageReporting: "read-only",
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 1_000,
		},
	});
	return stream;
}

function failedTerminalStream() {
	const stream = new AssistantMessageEventStream();
	stream.push({
		type: "error",
		reason: "error",
		failure: {
			code: AI_ERROR_CODES.AUTHENTICATION_FAILED,
			message: "Invalid API key: test-secret",
			retryable: false,
			statusCode: 401,
			provider: model.provider,
			modelId: model.id,
		},
		error: {
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
			stopReason: "error",
			errorMessage: "Invalid API key: test-secret",
			timestamp: 1_000,
		},
	});
	return stream;
}

describe("Provider preflight", () => {
	it("resolves the configured model and performs one cache-disabled low-token call", async () => {
		const streamFn = vi.fn(successfulStream);
		const loadRemoteModels = vi.fn(async () => undefined);

		const result = await runProviderPreflight(
			createDependencies(streamFn as unknown as SimpleStreamFunction, { loadRemoteModels }),
			{
				modelKey: "test-provider/test-model",
				timeoutMs: 5_000,
			},
		);

		expect(streamFn).toHaveBeenCalledOnce();
		expect(loadRemoteModels).not.toHaveBeenCalled();
		expect(streamFn.mock.calls[0]?.[2]).toMatchObject({
			apiKey: "test-secret",
			cacheRetention: "none",
			maxTokens: 16,
		});
		expect(result).toMatchObject({
			status: "ready",
			modelKey: "test-provider/test-model",
			credentialKind: "api-key",
			usage: { input: 3, output: 1, cacheUsageReporting: "read-only" },
		});
		expect(JSON.stringify(result)).not.toContain("test-secret");
	});

	it("fails before transport when the selected model has no credential", async () => {
		const streamFn = vi.fn(successfulStream) as unknown as SimpleStreamFunction;
		const promise = runProviderPreflight(createDependencies(streamFn, { getApiKey: async () => undefined }), {
			modelKey: "test-provider/test-model",
			timeoutMs: 5_000,
		});

		await expect(promise).rejects.toMatchObject({ code: "CREDENTIAL_MISSING" });
		expect(streamFn).not.toHaveBeenCalled();
	});

	it("maps normalized authentication failures to a stable preflight error", async () => {
		const promise = runProviderPreflight(
			createDependencies(() => {
				throw new AIError(AI_ERROR_CODES.AUTHENTICATION_FAILED, "Invalid API key", {
					provider: model.provider,
					modelId: model.id,
					statusCode: 401,
				});
			}),
			{ modelKey: "test-provider/test-model", timeoutMs: 5_000 },
		);

		await expect(promise).rejects.toMatchObject({
			code: "AUTHENTICATION_FAILED",
			details: { modelKey: "test-provider/test-model", failure: { code: "AI_AUTHENTICATION_FAILED" } },
		});
	});

	it("maps terminal error messages to the same safe failure contract", async () => {
		const promise = runProviderPreflight(createDependencies(failedTerminalStream), {
			modelKey: "test-provider/test-model",
			timeoutMs: 5_000,
		});

		await expect(promise).rejects.toMatchObject({
			code: "AUTHENTICATION_FAILED",
			message: "Provider authentication failed for test-provider/test-model",
			details: {
				modelKey: "test-provider/test-model",
				failure: { code: "AI_AUTHENTICATION_FAILED", statusCode: 401 },
			},
		});
		await expect(promise).rejects.not.toMatchObject({ details: { failure: { message: expect.anything() } } });
	});

	it("exposes authentication failures through the Debug contract", async () => {
		const [definition] = createProviderDebugDefinitions(
			createDependencies(() => {
				throw new AIError(AI_ERROR_CODES.AUTHENTICATION_FAILED, "Invalid API key");
			}),
		);
		if (!definition) throw new Error("Expected provider preflight definition");

		const input = definition.validateInput({ modelKey: "test-provider/test-model" });
		await expect(definition.run(input, { source: "local-server" })).rejects.toMatchObject({
			code: "DEBUG_PROVIDER_AUTHENTICATION_FAILED",
		});
		expect(() => definition.validateInput({ modelKey: "invalid", unexpected: true })).toThrowError();
	});

	it("returns safe model choices when the requested model is unavailable", async () => {
		const promise = runProviderPreflight(createDependencies(successfulStream, { find: () => undefined }), {
			modelKey: "missing/model",
			timeoutMs: 5_000,
		});

		await expect(promise).rejects.toEqual(
			expect.objectContaining<Partial<ProviderPreflightError>>({
				code: "MODEL_NOT_FOUND",
				details: expect.objectContaining({ availableModelKeys: ["test-provider/test-model"] }),
			}),
		);
	});

	it("reports Desktop authentication before model-not-found when the remote catalog is unauthorized", async () => {
		const promise = runProviderPreflight(
			createDependencies(successfulStream, {
				find: () => undefined,
				loadRemoteModels: async () => "unauthorized",
			}),
			{ modelKey: "remote/model", timeoutMs: 5_000 },
		);

		await expect(promise).rejects.toMatchObject({
			code: "AUTHENTICATION_FAILED",
			details: { modelKey: "remote/model", credentialKind: "desktop-login" },
		});
	});

	it("applies cancellation while an unavailable model is loading the remote catalog", async () => {
		const controller = new AbortController();
		const promise = runProviderPreflight(
			createDependencies(successfulStream, {
				find: () => undefined,
				loadRemoteModels: () => new Promise(() => undefined),
			}),
			{ modelKey: "remote/model", timeoutMs: 5_000 },
			controller.signal,
		);

		controller.abort();
		await expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });
	});
});
