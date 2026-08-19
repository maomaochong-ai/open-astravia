import type { Model, SimpleStreamFunction } from "@vetta/ai";
import { describe, expect, it, vi } from "vitest";
import { createProviderDebugDefinitions } from "./definitions.js";
import { listAvailableProviderModels, type ProviderModelListDependencies } from "./models.js";

const localModel: Model<"test-api"> = {
	id: "local-model",
	name: "Local model",
	api: "test-api",
	provider: "local-provider",
	baseUrl: "https://local-secret.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0 },
	contextWindow: 10_000,
	maxTokens: 1_000,
	headers: { Authorization: "Bearer local-secret" },
};

const remoteModel: Model<"test-api"> = {
	...localModel,
	id: "remote-model",
	name: "Remote model",
	provider: "remote-provider",
	baseUrl: "https://remote-secret.test",
	reasoning: true,
	input: ["text", "image"],
	contextWindow: 20_000,
	maxTokens: 2_000,
};

function createDependencies(
	overrides: Partial<ProviderModelListDependencies["models"]> = {},
): ProviderModelListDependencies {
	return {
		models: {
			getAvailable: () => [remoteModel, localModel],
			isRemote: (model) => model === remoteModel,
			loadRemoteModels: async () => undefined,
			...overrides,
		},
	};
}

describe("Provider model list", () => {
	it("loads the login catalog and returns a sorted privacy-safe runtime projection", async () => {
		const loadRemoteModels = vi.fn(async () => undefined);
		const result = await listAvailableProviderModels(createDependencies({ loadRemoteModels }));

		expect(loadRemoteModels).toHaveBeenCalledOnce();
		expect(result).toEqual({
			status: "ready",
			remoteCatalogStatus: "checked",
			modelCount: 2,
			localModelCount: 1,
			remoteModelCount: 1,
			models: [
				{
					modelKey: "local-provider/local-model",
					provider: "local-provider",
					id: "local-model",
					name: "Local model",
					api: "test-api",
					source: "local",
					reasoning: false,
					input: ["text"],
					contextWindow: 10_000,
					maxTokens: 1_000,
				},
				{
					modelKey: "remote-provider/remote-model",
					provider: "remote-provider",
					id: "remote-model",
					name: "Remote model",
					api: "test-api",
					source: "remote",
					reasoning: true,
					input: ["text", "image"],
					contextWindow: 20_000,
					maxTokens: 2_000,
				},
			],
		});
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("secret.test");
		expect(serialized).not.toContain("local-secret");
		expect(serialized).not.toContain("Authorization");
		expect(serialized).not.toContain("cost");
	});

	it("returns local choices while reporting an unauthorized remote catalog", async () => {
		const result = await listAvailableProviderModels(
			createDependencies({
				getAvailable: () => [localModel],
				loadRemoteModels: async () => "unauthorized",
			}),
		);

		expect(result).toMatchObject({
			remoteCatalogStatus: "unauthorized",
			modelCount: 1,
			localModelCount: 1,
			remoteModelCount: 0,
		});
	});

	it("stops waiting for the remote catalog when the Debug request is aborted", async () => {
		const controller = new AbortController();
		const promise = listAvailableProviderModels(
			createDependencies({ loadRemoteModels: () => new Promise(() => undefined) }),
			controller.signal,
		);

		controller.abort(new Error("cancelled"));
		await expect(promise).rejects.toThrow("cancelled");
	});

	it("registers an empty-input read-only Debug capability", async () => {
		const modelListDependencies = createDependencies();
		const dependencies = {
			models: {
				...modelListDependencies.models,
				find: () => localModel,
				getApiKey: async () => undefined,
				isUsingOAuth: () => false,
			},
			streamFn: vi.fn() as unknown as SimpleStreamFunction,
		};
		const definition = createProviderDebugDefinitions(dependencies).find(
			(candidate) => candidate.id === "provider.models.list",
		);
		if (!definition) throw new Error("Expected provider.models.list definition");

		const input = definition.validateInput({});
		await expect(definition.run(input, { source: "local-server" })).resolves.toMatchObject({ modelCount: 2 });
		expect(() => definition.validateInput({ includeCredentials: true })).toThrowError();
		expect(dependencies.streamFn).not.toHaveBeenCalled();
	});
});
