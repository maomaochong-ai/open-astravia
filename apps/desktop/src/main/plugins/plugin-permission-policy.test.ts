import { describe, expect, it } from "vitest";
import {
	effectivePluginCommands,
	effectivePluginPermissions,
	grantDeclaredPluginCommands,
} from "./plugin-permission-policy.js";

describe("effectivePluginPermissions", () => {
	it("preserves declared permissions for every plugin trust level", () => {
		const permissions = [
			"browser.read",
			"browser.interact",
			"browser.profile.persist",
			"browser.attach",
			"browser.runtime.manage",
		] as const;
		expect(effectivePluginPermissions(permissions)).toEqual(permissions);
	});

	it("preserves declared commands for user plugins", () => {
		expect(effectivePluginCommands(["demo.run", "demo.run"])).toEqual(["demo.run"]);
	});

	it("grants only requested command names that the plugin declared", () => {
		expect(grantDeclaredPluginCommands(["git"], ["node", "powershell"], ["git", "node"])).toEqual(["git", "node"]);
	});
});
