import { describe, expect, it } from "vitest";
import { effectivePluginPermissions } from "./plugin-permission-policy.js";

describe("effectivePluginPermissions", () => {
	it("keeps general browser permissions but strips official-only attach and runtime management", () => {
		const permissions = [
			"browser.read",
			"browser.interact",
			"browser.profile.persist",
			"browser.attach",
			"browser.runtime.manage",
		] as const;
		expect(effectivePluginPermissions(permissions, "community")).toEqual([
			"browser.read",
			"browser.interact",
			"browser.profile.persist",
		]);
		expect(effectivePluginPermissions(permissions, "official")).toEqual(permissions);
	});
});
