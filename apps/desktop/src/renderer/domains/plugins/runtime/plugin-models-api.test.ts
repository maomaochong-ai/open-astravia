import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginModelsApi } from "./plugin-models-api.js";

const { revalidate } = vi.hoisted(() => ({ revalidate: vi.fn(async () => undefined) }));

vi.mock("@shared/store/model-catalog", () => ({ modelCatalog: { revalidate } }));

afterEach(() => {
	vi.clearAllMocks();
	Reflect.deleteProperty(globalThis, "window");
});

describe("createPluginModelsApi", () => {
	it("refreshes the local model catalog after owned provider mutations", async () => {
		const models = {
			upsertOwnedProvider: vi.fn(async () => undefined),
			removeOwnedProvider: vi.fn(async () => undefined),
		};
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { vetta: { plugins: { internalCapabilities: { models } } } },
		});
		const permissions = { require: vi.fn(), has: vi.fn(() => true) };
		const api = createPluginModelsApi(permissions, "capability-session");

		await api.upsertProvider("google", { models: [{ id: "gemini-test" }] });
		await api.removeProvider("google");

		expect(models.upsertOwnedProvider).toHaveBeenCalledWith("capability-session", "google", {
			models: [{ id: "gemini-test" }],
		});
		expect(models.removeOwnedProvider).toHaveBeenCalledWith("capability-session", "google");
		expect(revalidate).toHaveBeenCalledTimes(2);
		expect(revalidate).toHaveBeenCalledWith({ force: true, sources: ["local"] });
	});
});
