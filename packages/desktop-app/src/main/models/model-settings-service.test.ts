import { describe, expect, it, vi } from "vitest";
import type { ModelCredentialStore } from "./model-credential-store.js";
import { ModelSettingsService, type ModelsConfig } from "./model-settings-service.js";

function createConfig(): ModelsConfig {
	return {
		defaultModel: "openai/gpt-5",
		providers: {
			openai: {
				displayName: "OpenAI",
				credentialRef: "openai-credential",
				headers: { Authorization: "Bearer secret", "X-Region": "us" },
				models: [{ id: "gpt-5", reasoning: true }],
			},
		},
	};
}

function createCredentialStore(initial: Record<string, string> = {}): ModelCredentialStore & {
	values: Map<string, string>;
} {
	const values = new Map(Object.entries(initial));
	return {
		values,
		isAvailable: () => true,
		has: (credentialRef) => values.has(credentialRef),
		get: (credentialRef) => values.get(credentialRef),
		set: (credentialRef, value) => {
			values.set(credentialRef, value);
		},
		remove: (credentialRef) => {
			values.delete(credentialRef);
		},
	};
}

describe("ModelSettingsService", () => {
	it("returns masked renderer config and sanitized capability data", async () => {
		const credentials = createCredentialStore({ "openai-credential": "secret" });
		const service = new ModelSettingsService({
			readConfig: async () => createConfig(),
			writeConfig: vi.fn(),
			refreshRegistry: vi.fn(),
			credentials,
		});

		await expect(service.getRendererConfig()).resolves.toMatchObject({
			providers: { openai: { apiKey: "***", credentialRef: "openai-credential" } },
		});
		await expect(service.getSanitizedConfig()).resolves.toEqual({
			defaultModel: "openai/gpt-5",
			providers: {
				openai: {
					displayName: "OpenAI",
					apiKey: "***",
					headers: { Authorization: "***", "X-Region": "us" },
					models: [{ id: "gpt-5", reasoning: true }],
				},
			},
		});
	});

	it("keeps an encrypted key when renderer sends the mask", async () => {
		let config = createConfig();
		const credentials = createCredentialStore({ "openai-credential": "secret" });
		const writeConfig = vi.fn<(next: ModelsConfig) => Promise<void>>(async (next) => {
			config = next;
		});
		const refreshRegistry = vi.fn<() => Promise<void>>(async () => {});
		const service = new ModelSettingsService({
			readConfig: async () => config,
			writeConfig,
			refreshRegistry,
			credentials,
		});

		const renderer = await service.getRendererConfig();
		renderer.providers.openai = {
			...renderer.providers.openai,
			displayName: "OpenAI Updated",
		};
		await service.replaceConfig(renderer);

		expect(config.providers.openai).toMatchObject({
			displayName: "OpenAI Updated",
			credentialRef: "openai-credential",
		});
		expect(config.providers.openai?.apiKey).toBeUndefined();
		expect(credentials.values.get("openai-credential")).toBe("secret");
		expect(refreshRegistry).toHaveBeenCalledOnce();
	});

	it("keeps an encrypted key when a capability updates provider metadata", async () => {
		let config = createConfig();
		const credentials = createCredentialStore({ "openai-credential": "secret" });
		const service = new ModelSettingsService({
			readConfig: async () => config,
			writeConfig: async (next) => {
				config = next;
			},
			refreshRegistry: async () => {},
			credentials,
		});

		await expect(
			service.upsertProvider("openai", {
				displayName: "OpenAI Updated",
				models: [{ id: "gpt-5.1", reasoning: true }],
			}),
		).resolves.toMatchObject({
			displayName: "OpenAI Updated",
			apiKey: "***",
			models: [{ id: "gpt-5.1", reasoning: true }],
		});
		expect(config.providers.openai?.credentialRef).toBe("openai-credential");
		expect(config.providers.openai?.apiKey).toBeUndefined();
		expect(credentials.values.get("openai-credential")).toBe("secret");
	});

	it("replaces and clears an encrypted key without writing plaintext", async () => {
		let config = createConfig();
		const credentials = createCredentialStore({ "openai-credential": "secret" });
		const service = new ModelSettingsService({
			readConfig: async () => config,
			writeConfig: async (next) => {
				config = next;
			},
			refreshRegistry: async () => {},
			credentials,
		});

		const replacement = await service.getRendererConfig();
		replacement.providers.openai.apiKey = "replacement-secret";
		await service.replaceConfig(replacement);

		expect(config.providers.openai?.apiKey).toBeUndefined();
		expect(credentials.values.get("openai-credential")).toBe("replacement-secret");

		const cleared = await service.getRendererConfig();
		delete cleared.providers.openai.apiKey;
		await service.replaceConfig(cleared);

		expect(config.providers.openai?.credentialRef).toBeUndefined();
		expect(credentials.values.has("openai-credential")).toBe(false);
	});

	it("keeps an encrypted key when its provider is renamed", async () => {
		let config = createConfig();
		const credentials = createCredentialStore({ "openai-credential": "secret" });
		const service = new ModelSettingsService({
			readConfig: async () => config,
			writeConfig: async (next) => {
				config = next;
			},
			refreshRegistry: async () => {},
			credentials,
		});

		const renderer = await service.getRendererConfig();
		renderer.providers.customOpenai = renderer.providers.openai;
		delete renderer.providers.openai;
		await service.replaceConfig(renderer);

		expect(config.providers.customOpenai).toMatchObject({ credentialRef: "openai-credential" });
		expect(credentials.values.get("openai-credential")).toBe("secret");
	});

	it("moves a legacy literal key into the credential store before removing plaintext", async () => {
		let config: ModelsConfig = {
			providers: { openai: { apiKey: "sk-legacy", models: [{ id: "gpt-5" }] } },
		};
		const credentials = createCredentialStore();
		const service = new ModelSettingsService({
			readConfig: async () => config,
			writeConfig: async (next) => {
				config = next;
			},
			refreshRegistry: async () => {},
			credentials,
		});

		const renderer = await service.getRendererConfig();
		const credentialRef = config.providers.openai?.credentialRef;

		expect(credentialRef).toBeTypeOf("string");
		expect(config.providers.openai?.apiKey).toBeUndefined();
		expect(credentials.values.get(credentialRef as string)).toBe("sk-legacy");
		expect(renderer.providers.openai?.apiKey).toBe("***");
		await expect(service.getConfig()).resolves.toMatchObject({
			providers: { openai: { apiKey: "sk-legacy" } },
		});
	});

	it("clears the encrypted credential with a removed provider", async () => {
		let config = createConfig();
		const credentials = createCredentialStore({ "openai-credential": "secret" });
		const service = new ModelSettingsService({
			readConfig: async () => config,
			writeConfig: async (next) => {
				config = next;
			},
			refreshRegistry: async () => {},
			credentials,
		});

		await service.removeProvider("openai");

		expect(config).toEqual({ providers: {} });
		expect(credentials.values.has("openai-credential")).toBe(false);
	});
});
