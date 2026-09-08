import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginModelsApi } from "./plugin-models-api.js";

afterEach(() => {
	vi.clearAllMocks();
	Reflect.deleteProperty(globalThis, "window");
});

describe("createPluginModelsApi", () => {
	it("replaces all owned providers through the capability session", async () => {
		const models = { replaceOwnedProviders: vi.fn(async () => undefined) };
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { vetta: { plugins: { internalCapabilities: { models } } } },
		});
		const permissions = { require: vi.fn(), has: vi.fn(() => true) };
		const api = createPluginModelsApi(permissions, "capability-session");

		await api.replaceOwnedProviders({ google: { models: [{ id: "gemini-test" }] } });

		expect(models.replaceOwnedProviders).toHaveBeenCalledWith("capability-session", {
			google: { models: [{ id: "gemini-test" }] },
		});
	});

	it("reads back the providers the host currently holds for this plugin", async () => {
		const published = { google: { models: [{ id: "gemini-test" }], apiKey: "***" } };
		const models = { listOwnedProviders: vi.fn(async () => published) };
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { vetta: { plugins: { internalCapabilities: { models } } } },
		});
		const permissions = { require: vi.fn(), has: vi.fn(() => true) };
		const api = createPluginModelsApi(permissions, "capability-session");

		await expect(api.listOwnedProviders()).resolves.toEqual(published);

		expect(permissions.require).toHaveBeenCalledWith("models.manage");
		expect(models.listOwnedProviders).toHaveBeenCalledWith("capability-session");
	});
});
