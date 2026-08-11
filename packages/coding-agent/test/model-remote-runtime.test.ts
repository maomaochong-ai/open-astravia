import type { OAuthProviderInterface } from "@vetta/ai";
import { describe, expect, test, vi } from "vitest";
import { createCodingAgentModelRuntime, type ModelCredential, type ModelCredentialStore } from "../src/models/index.js";

class EmptyCredentialStore implements ModelCredentialStore {
	setFallbackResolver(): void {}

	get(): ModelCredential | undefined {
		return undefined;
	}

	hasAuth(): boolean {
		return false;
	}

	getApiKey(): Promise<string | undefined> {
		return Promise.resolve(undefined);
	}

	getOAuthProviders(): readonly OAuthProviderInterface[] {
		return [];
	}
}

describe("remote model runtime", () => {
	test("does not request the remote catalog without both URL and token", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>();
		const runtime = createRuntime(fetch);

		runtime.setServerUrl("https://models.example.com/");
		await runtime.loadRemoteModels();

		expect(fetch).not.toHaveBeenCalled();
	});

	test("deduplicates concurrent catalog loads and exposes remote credentials live", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
			jsonResponse({
				code: 0,
				data: {
					providers: {
						gateway: {
							api: "openai-completions",
							baseUrl: "https://gateway.example.com/v1",
							headers: { "X-Route": "stable" },
							models: [
								{
									id: "visible-model",
									modelId: "upstream-model",
									upstreamBaseUrl: "https://upstream.example.com/v1",
								},
							],
						},
					},
				},
			}),
		);
		let token = "first-token";
		const runtime = createRuntime(fetch);
		runtime.setServerUrl("https://models.example.com/");
		runtime.setServerTokenGetter(() => token);

		await Promise.all([runtime.loadRemoteModels(), runtime.loadRemoteModels()]);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith(
			"https://models.example.com/providers/models.json",
			expect.objectContaining({ headers: { Accept: "application/json", Authorization: "Bearer first-token" } }),
		);
		const model = runtime.find("gateway", "visible-model");
		expect(model).toMatchObject({
			modelId: "upstream-model",
			baseUrl: "https://upstream.example.com/v1",
			gatewayUrl: "https://gateway.example.com/v1",
			input: ["text"],
			headers: { "X-Route": "stable" },
		});
		expect(model && runtime.isRemote(model)).toBe(true);
		expect(model && (await runtime.getApiKey(model))).toBe("first-token");
		token = "second-token";
		expect(model && (await runtime.getApiKey(model))).toBe("second-token");
	});

	test("reports unauthorized responses without mutating the catalog", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 401 }));
		const runtime = configuredRuntime(fetch, "token");

		await expect(runtime.loadRemoteModels()).resolves.toBe("unauthorized");
		expect(runtime.getAll()).toEqual([]);
	});

	test("keeps the catalog unchanged for HTTP and schema failures", async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(new Response(null, { status: 503 }))
			.mockResolvedValueOnce(jsonResponse({ code: 0, data: { providers: [] } }));
		const runtime = configuredRuntime(fetch, "first-token");

		await expect(runtime.loadRemoteModels()).resolves.toBeUndefined();
		runtime.setServerToken("second-token");
		await expect(runtime.loadRemoteModels()).resolves.toBeUndefined();
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(runtime.getAll()).toEqual([]);
	});
});

function createRuntime(fetch: typeof globalThis.fetch) {
	return createCodingAgentModelRuntime(new EmptyCredentialStore(), {
		modelsJsonPath: "missing-model-runtime-test.json",
		builtInModels: [],
		remoteSource: { fetch, timeoutMs: 100 },
	});
}

function configuredRuntime(fetch: typeof globalThis.fetch, token: string) {
	const runtime = createRuntime(fetch);
	runtime.setServerUrl("https://models.example.com");
	runtime.setServerToken(token);
	return runtime;
}

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
