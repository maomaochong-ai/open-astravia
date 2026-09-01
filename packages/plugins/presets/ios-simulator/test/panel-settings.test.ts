import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_PANEL_SETTINGS,
	normalizePanelSettings,
	PanelSettingsStore,
} from "../src/runtime/panel-settings.js";

describe("normalizePanelSettings", () => {
	it("keeps valid values", () => {
		expect(
			normalizePanelSettings({ alwaysShowTab: true, autoStartServer: false, defaultDeviceUdid: "ABC" }),
		).toEqual({ alwaysShowTab: true, autoStartServer: false, defaultDeviceUdid: "ABC" });
	});

	it("treats an empty pinned udid as automatic selection", () => {
		expect(normalizePanelSettings({ defaultDeviceUdid: "" }).defaultDeviceUdid).toBeNull();
		expect(normalizePanelSettings({ defaultDeviceUdid: 42 }).defaultDeviceUdid).toBeNull();
	});

	it("falls back per field for missing or wrongly typed values", () => {
		// 存储里的值是不可信输入：半损坏的记录不应该整份丢弃，也不应该原样透传。
		expect(normalizePanelSettings({ alwaysShowTab: "yes" })).toEqual(DEFAULT_PANEL_SETTINGS);
		expect(normalizePanelSettings({ autoStartServer: false })).toEqual({
			alwaysShowTab: false,
			autoStartServer: false,
			defaultDeviceUdid: null,
		});
	});

	it("falls back entirely for non-objects", () => {
		expect(normalizePanelSettings(null)).toEqual(DEFAULT_PANEL_SETTINGS);
		expect(normalizePanelSettings("nope")).toEqual(DEFAULT_PANEL_SETTINGS);
	});

	it("defaults to project-scoped tab and auto-started service", () => {
		expect(DEFAULT_PANEL_SETTINGS).toEqual({
			alwaysShowTab: false,
			autoStartServer: true,
			defaultDeviceUdid: null,
		});
	});
});

describe("PanelSettingsStore", () => {
	it("loads once and shares concurrent loads", async () => {
		const readJson = vi.fn(async () => ({ alwaysShowTab: true, autoStartServer: true, defaultDeviceUdid: null }));
		const store = new PanelSettingsStore({ readJson, writeJson: vi.fn(async () => undefined) });
		const [a, b] = await Promise.all([store.load(), store.load()]);
		expect(a).toEqual(b);
		await store.load();
		expect(readJson).toHaveBeenCalledTimes(1);
		expect(store.current().alwaysShowTab).toBe(true);
	});

	it("treats a storage read failure as defaults instead of blocking the panel", async () => {
		const store = new PanelSettingsStore({
			readJson: vi.fn(async () => {
				throw new Error("storage offline");
			}),
			writeJson: vi.fn(async () => undefined),
		});
		expect(await store.load()).toEqual(DEFAULT_PANEL_SETTINGS);
	});

	it("persists a patch and notifies subscribers", async () => {
		const writeJson = vi.fn(async () => undefined);
		const store = new PanelSettingsStore({ readJson: vi.fn(async () => null), writeJson });
		const seen: boolean[] = [];
		store.subscribe((settings) => seen.push(settings.alwaysShowTab));
		await store.update({ alwaysShowTab: true });
		expect(writeJson).toHaveBeenCalledWith("panel-settings", {
			alwaysShowTab: true,
			autoStartServer: true,
			defaultDeviceUdid: null,
		});
		expect(seen).toEqual([false, true]);
	});

	it("does not let a later load overwrite an update made before loading", async () => {
		const store = new PanelSettingsStore({
			readJson: vi.fn(async () => ({ alwaysShowTab: false, autoStartServer: false, defaultDeviceUdid: null })),
			writeJson: vi.fn(async () => undefined),
		});
		await store.update({ alwaysShowTab: true });
		expect((await store.load()).alwaysShowTab).toBe(true);
	});
});
