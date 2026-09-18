import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prefetchSettingsTab, SETTINGS_TAB_LOADERS } from "./settings-tab-loaders";

afterEach(() => vi.restoreAllMocks());

describe("settings tab code prefetch", () => {
	it("loads only the selected tab and allows a later retry", async () => {
		const loadGeneral = vi
			.spyOn(SETTINGS_TAB_LOADERS, "general")
			.mockRejectedValueOnce(new Error("chunk unavailable"))
			.mockResolvedValue({ default: () => createElement("div") });
		const loadModels = vi.spyOn(SETTINGS_TAB_LOADERS, "models");
		prefetchSettingsTab("general");
		await Promise.resolve();
		prefetchSettingsTab("general");
		prefetchSettingsTab("unknown");
		expect(loadGeneral).toHaveBeenCalledTimes(2);
		expect(loadModels).not.toHaveBeenCalled();
	});
});
