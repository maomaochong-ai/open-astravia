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
		expect(registry.commit("demo", "first")).toBe(true);

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
		expect(registry.getTools("demo")).toMatchObject([{ id: "first-tool" }]);
		expect(
			registry.registerTool("demo", {
				id: "second-tool",
				name: "second_tool",
				description: "second",
				parameters: {},
				handlerId: "second-handler",
				activationId: "second",
			}),
		).toBe(true);
		expect(registry.getTools("demo")).toMatchObject([{ id: "first-tool" }]);
		expect(registry.commit("demo", "second")).toBe(true);
		expect(registry.getTools("demo")).toMatchObject([{ id: "second-tool" }]);
	});

	it("does not let a stale clear remove the current activation", () => {
		const registry = createRegistry();
		registry.beginLoad("demo", "current");
		registry.registerContinuation("demo", {
			id: "provider",
			handlerId: "handler",
			activationId: "current",
		});
		registry.commit("demo", "current");

		expect(registry.clear("demo", "stale")).toBeUndefined();
		expect(registry.getContinuations("demo")).toHaveLength(1);
		expect(registry.clear("demo", "current")).toEqual({ toolCount: 0, hookCount: 0, continuationCount: 1 });
		expect(registry.getContinuations("demo")).toEqual([]);
	});

	it("discards a failed candidate without disturbing the published last-known-good activation", () => {
		const registry = createRegistry();
		registry.beginLoad("demo", "published");
		registry.registerTool("demo", {
			id: "tool",
			name: "published_tool",
			description: "published",
			parameters: {},
			handlerId: "shared-handler",
			activationId: "published",
		});
		registry.commit("demo", "published");
		registry.beginLoad("demo", "candidate");
		registry.registerTool("demo", {
			id: "tool",
			name: "candidate_tool",
			description: "candidate",
			parameters: {},
			handlerId: "shared-handler",
			activationId: "candidate",
		});

		expect(registry.clear("demo", "candidate")).toEqual({
			toolCount: 1,
			hookCount: 0,
			continuationCount: 0,
		});
		expect(registry.getTools("demo")).toMatchObject([{ name: "published_tool", activationId: "published" }]);
	});
});
