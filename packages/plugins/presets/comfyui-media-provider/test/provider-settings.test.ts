import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_PROVIDER_SETTINGS,
	normalizeProviderSettings,
	ProviderSettingsStore,
} from "../src/settings/provider-settings";

function createStore(initial: unknown = null) {
	let stored: unknown = initial;
	const writeJson = vi.fn(async (_key: string, value: unknown) => {
		stored = value;
	});
	const store = new ProviderSettingsStore({
		readJson: async () => stored,
		writeJson,
	});
	return { store, writeJson, read: () => stored };
}

describe("normalizeProviderSettings", () => {
	it("falls back to defaults for missing or non-string fields", () => {
		expect(normalizeProviderSettings({ baseUrl: 42, templatePromptId: " job-1 " })).toEqual({
			...DEFAULT_PROVIDER_SETTINGS,
			templatePromptId: "job-1",
		});
	});

	it("treats a non-object as empty", () => {
		expect(normalizeProviderSettings(null)).toEqual(DEFAULT_PROVIDER_SETTINGS);
	});
});

describe("ProviderSettingsStore", () => {
	it("loads stored values once and serves them synchronously afterwards", async () => {
		const { store } = createStore({ baseUrl: "http://comfy.local:8188" });

		expect(store.current().baseUrl).toBe(DEFAULT_PROVIDER_SETTINGS.baseUrl);
		await store.load();
		expect(store.current().baseUrl).toBe("http://comfy.local:8188");
	});

	it("falls back to defaults when storage cannot be read", async () => {
		const store = new ProviderSettingsStore({
			readJson: async () => {
				throw new Error("storage offline");
			},
			writeJson: async () => undefined,
		});

		await store.load();

		expect(store.current()).toEqual(DEFAULT_PROVIDER_SETTINGS);
	});

	it("persists the whole normalized set and notifies subscribers", async () => {
		const { store, read } = createStore();
		const listener = vi.fn();
		store.subscribe(listener);
		await store.load();

		await store.update({ templatePromptId: " job-9 " });

		expect(read()).toEqual({ ...DEFAULT_PROVIDER_SETTINGS, templatePromptId: "job-9" });
		expect(store.current().templatePromptId).toBe("job-9");
		expect(listener).toHaveBeenCalled();
	});

	it("stops notifying after unsubscribe", async () => {
		const { store } = createStore();
		const listener = vi.fn();
		const unsubscribe = store.subscribe(listener);
		await store.load();
		const callsBefore = listener.mock.calls.length;

		unsubscribe();
		await store.update({ baseUrl: "http://other:8188" });

		expect(listener).toHaveBeenCalledTimes(callsBefore);
	});
});
