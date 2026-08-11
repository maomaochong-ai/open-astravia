import { describe, expect, it } from "vitest";
import { createVettaPluginFederationConfig } from "../src/index.js";

function readShared(options: Parameters<typeof createVettaPluginFederationConfig>[0]) {
	const shared = createVettaPluginFederationConfig(options).shared;
	if (shared === undefined || Array.isArray(shared)) {
		throw new Error("Expected object-form Module Federation shared config");
	}
	return shared;
}

describe("createVettaPluginFederationConfig", () => {
	it("does not couple every plugin to the optional host Theme UI contract", () => {
		const shared = readShared({ name: "default_plugin" });

		expect(shared).not.toHaveProperty("@vetta/theme-ui/plugin-ui");
	});

	it("shares the host Theme UI contract only when explicitly enabled", () => {
		const shared = readShared({ name: "theme_ui_plugin", hostThemeUi: true });

		expect(shared).toHaveProperty("@vetta/theme-ui/plugin-ui", {
			singleton: true,
			import: false,
			requiredVersion: "*",
		});
	});
});
