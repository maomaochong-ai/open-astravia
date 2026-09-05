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
});
