import { describe, expect, it, vi } from "vitest";
import {
	CONTENT_PLAIN_DEFAULTS,
	ContentSettingsStore,
	normalizePlainSettings,
} from "../src/settings/content-settings";

function createStore() {
	const json = new Map<string, unknown>();
	const secrets = new Map<string, string>();
	const writeSecret = vi.fn(async (key: string, value: string) => {
		if (value) secrets.set(key, value);
		else secrets.delete(key);
	});
	const store = new ContentSettingsStore({
		readJson: async (key) => json.get(key) ?? null,
		writeJson: async (key, value) => {
			json.set(key, value);
		},
		readSecret: async (key) => secrets.get(key),
		writeSecret,
	});
	return { store, json, secrets, writeSecret };
}

describe("normalizePlainSettings", () => {
	it("keeps only declared string fields and falls back to defaults", () => {
		expect(normalizePlainSettings({ customModel: " gpt-x ", openaiModel: 42, injected: "nope" })).toEqual({
			...CONTENT_PLAIN_DEFAULTS,
			customModel: "gpt-x",
		});
	});

	it("treats a non-object as empty", () => {
		expect(normalizePlainSettings("nope")).toEqual({ ...CONTENT_PLAIN_DEFAULTS });
	});
});

describe("ContentSettingsStore", () => {
	it("reads plain values and secrets into one synchronous view", async () => {
		const { store, json, secrets } = createStore();
		json.set("settings.json", { customBaseUrl: "https://api.example.com" });
		secrets.set("openaiApiKey", "sk-live");

		await store.load();

		expect(store.get("customBaseUrl")).toBe("https://api.example.com");
		expect(store.get("openaiApiKey")).toBe("sk-live");
		expect(store.get("openaiModel")).toBe(CONTENT_PLAIN_DEFAULTS.openaiModel);
		expect(store.get("unknown")).toBeUndefined();
	});

	it("routes secrets to the vault and never into plugin storage", async () => {
		const { store, json, secrets } = createStore();
		await store.load();

		await store.setSecret("googleApiKey", " key-1 ");

		expect(secrets.get("googleApiKey")).toBe("key-1");
		expect(store.hasSecret("googleApiKey")).toBe(true);
		expect(JSON.stringify(json.get("settings.json") ?? {})).not.toContain("key-1");
	});

	it("clears a secret when an empty value is saved", async () => {
		const { store, secrets, writeSecret } = createStore();
		secrets.set("customApiKey", "old");
		await store.load();

		await store.setSecret("customApiKey", "  ");

		expect(writeSecret).toHaveBeenCalledWith("customApiKey", "");
		expect(store.hasSecret("customApiKey")).toBe(false);
		expect(store.get("customApiKey")).toBeUndefined();
	});

	it("notifies subscribers on every write and stops after unsubscribe", async () => {
		const { store } = createStore();
		const listener = vi.fn();
		const unsubscribe = store.subscribe(listener);
		await store.load();
		await store.updatePlain({ customModel: "m1" });
		await store.setSecret("openaiApiKey", "sk");

		expect(listener).toHaveBeenCalledTimes(3);

		unsubscribe();
		await store.updatePlain({ customModel: "m2" });
		expect(listener).toHaveBeenCalledTimes(3);
	});

	it("persists the whole normalized set so a later load sees the same values", async () => {
		const { store, json } = createStore();
		await store.load();
		await store.updatePlain({ customVideoModel: " v1 " });

		expect(json.get("settings.json")).toMatchObject({ customVideoModel: "v1" });
		expect(normalizePlainSettings(json.get("settings.json")).customVideoModel).toBe("v1");
	});
});
