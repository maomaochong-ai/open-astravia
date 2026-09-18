import { describe, expect, it } from "vitest";
import { prefetchSettingsTab, SETTINGS_TAB_LOADERS } from "./settings-tab-loaders";

describe("prefetchSettingsTab", () => {
	it("mcp 深链预取 general，已知标签都有 loader", () => {
		expect(typeof SETTINGS_TAB_LOADERS.general).toBe("function");
		expect(typeof SETTINGS_TAB_LOADERS.models).toBe("function");
		expect(typeof SETTINGS_TAB_LOADERS.context).toBe("function");
		prefetchSettingsTab("mcp");
		prefetchSettingsTab("models");
		prefetchSettingsTab("not-a-tab");
	});
});
