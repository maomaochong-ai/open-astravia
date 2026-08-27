import type { PluginAgentToolRegistration, PluginContext } from "@vetta-org/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import type { BrowserSessionBroker, BrowserToolInput } from "../src/agent/browser-session-broker";
import { BROWSER_TOOL_NAME, registerBrowserTool } from "../src/agent/browser-tool";

describe("registerBrowserTool", () => {
	it("registers one structured heavy tool for all interactive conversation scenarios", () => {
		let registration: PluginAgentToolRegistration<BrowserToolInput> | undefined;
		const ctx = {
			agent: {
				registerTool: (value: PluginAgentToolRegistration<BrowserToolInput>) => {
					registration = value;
					return { dispose: vi.fn() };
				},
			},
		} as unknown as PluginContext;
		registerBrowserTool(ctx, { execute: vi.fn() } as unknown as BrowserSessionBroker);
		expect(registration).toMatchObject({
			name: BROWSER_TOOL_NAME,
			side_effect: "heavy",
			scope_use: ["conversation", "project", "im-claw", "cli"],
		});
		expect(registration?.description).toContain("profileId");
		expect(registration?.description).toContain("irreversible");
	});
});
