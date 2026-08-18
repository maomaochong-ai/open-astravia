import type { InstalledPlugin } from "@preload/api";
import { describe, expect, it, vi } from "vitest";
import { PluginLocalContributions } from "./plugin-local-contributions";

describe("PluginLocalContributions", () => {
	it("publishes stable collection references and clears them in place", () => {
		const contributions = new PluginLocalContributions();
		contributions.slots.push({ id: "demo:slot", component: vi.fn() });
		const loaded = contributions.toLoadedPlugin(
			{
				id: "demo",
				name: "Demo",
				activeVersion: "1.0.0",
				defaultLocale: "zh",
				locales: {},
			} as InstalledPlugin,
			async () => undefined,
		);

		expect(loaded.slots).toBe(contributions.slots);
		contributions.clear();
		expect(loaded.slots).toEqual([]);
	});
});
