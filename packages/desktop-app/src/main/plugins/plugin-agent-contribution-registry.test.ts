import { describe, expect, it } from "vitest";
import { DesktopPluginHookRegistry } from "./coding-agent-hook-registry.js";
import { PluginAgentContributionRegistry } from "./plugin-agent-contribution-registry.js";

function createRegistry(): PluginAgentContributionRegistry {
	return new PluginAgentContributionRegistry(new DesktopPluginHookRegistry());
}

describe("PluginAgentContributionRegistry", () => {
	it("replaces an activation atomically and ignores stale updates", () => {
		const registry = createRegistry();
		registry.beginLoad("demo", "first");
		expect(
			registry.registerTool("demo", {
				id: "first-tool",
				name: "first_tool",
				description: "first",
				parameters: {},
				handlerId: "first-handler",
				activationId: "first",
			}),
		).toBe(true);

		expect(registry.beginLoad("demo", "second")).toEqual({ toolCount: 1, hookCount: 0, continuationCount: 0 });
		expect(
			registry.registerTool("demo", {
				id: "stale-tool",
				name: "stale_tool",
				description: "stale",
				parameters: {},
				handlerId: "stale-handler",
				activationId: "first",
			}),
		).toBe(false);
		expect(registry.getTools("demo")).toEqual([]);
	});

	it("does not let a stale clear remove the current activation", () => {
		const registry = createRegistry();
		registry.beginLoad("demo", "current");
		registry.registerContinuation("demo", {
			id: "provider",
			handlerId: "handler",
			activationId: "current",
		});

		expect(registry.clear("demo", "stale")).toBeUndefined();
		expect(registry.getContinuations("demo")).toHaveLength(1);
		expect(registry.clear("demo", "current")).toEqual({ toolCount: 0, hookCount: 0, continuationCount: 1 });
		expect(registry.getContinuations("demo")).toEqual([]);
	});
});
