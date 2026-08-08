// @vitest-environment jsdom

import type { RegisteredActivityTab } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { toPluginDefinition } from "./useActivityTabDefinitions";

describe("plugin activity tab definitions", () => {
	it("preserves lifecycle declarations", () => {
		const tab: RegisteredActivityTab = {
			pluginId: "remotion-renderer",
			pluginName: "Remotion",
			tabId: "studio",
			label: "Studio",
			component: () => null,
			scope_use: ["project"],
			keepAliveWhenAvailable: true,
		};

		const definition = toPluginDefinition(tab, (_pluginId, text) => text);

		expect(definition.keepAliveWhenAvailable).toBe(true);
	});
});
