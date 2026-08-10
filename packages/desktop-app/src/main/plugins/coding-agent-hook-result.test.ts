import { describe, expect, it } from "vitest";
import { parseDesktopPluginHookResult } from "./coding-agent-hook-result.js";

describe("parseDesktopPluginHookResult", () => {
	it("maps event-specific results to Coding Agent effects", () => {
		expect(
			parseDesktopPluginHookResult("PermissionRequest", {
				action: "continue",
				permissionDecision: "deny",
				permissionMessage: "policy denied",
			}),
		).toMatchObject({ permissionDecision: "deny", permissionMessage: "policy denied" });
		expect(
			parseDesktopPluginHookResult("Stop", {
				action: "continue-agent",
				continuationFragments: ["continue checking"],
			}),
		).toMatchObject({ shouldBlock: true, continuationFragments: ["continue checking"] });
	});

	it("rejects fields outside the selected action and event contract", () => {
		expect(() =>
			parseDesktopPluginHookResult("PostToolUse", {
				action: "continue",
				updatedToolInput: {},
			}),
		).toThrow("updatedToolInput is not allowed");
		expect(() =>
			parseDesktopPluginHookResult("PreToolUse", {
				action: "block",
				reason: "blocked",
				additionalContexts: ["unexpected"],
			}),
		).toThrow("additionalContexts is not allowed");
	});
});
