import type { AgentPluginRuntimeConfig } from "@vetta/coding-agent/plugin-runtime";
import { describe, expect, it, vi } from "vitest";
import { DesktopCodingAgentPluginRuntimeSource } from "./coding-agent-plugin-runtime-source.js";

describe("DesktopCodingAgentPluginRuntimeSource", () => {
	it("merges Desktop built-in Skills once and publishes changes to existing Sessions", () => {
		const build = vi.fn((): AgentPluginRuntimeConfig => configuration("initial"));
		const source = new DesktopCodingAgentPluginRuntimeSource({
			build,
			additionalSkillPaths: ["C:/vetta/builtin-skills"],
			handlerLeaseProvider: { bindForTurn: () => ({ release() {} }) },
		});
		const listener = vi.fn();
		source.subscribe(listener);

		expect(source.readAgentPlugins()?.skillPathContributions).toEqual([
			{ pluginId: "initial", paths: ["C:/plugins/initial"] },
			{ pluginId: "desktop:builtin-skills", paths: ["C:/vetta/builtin-skills"] },
		]);
		expect(source.readAgentPlugins()?.skillPathContributions).toHaveLength(2);
		expect(build).toHaveBeenCalledOnce();

		source.publish(configuration("updated"));
		expect(listener).toHaveBeenCalledOnce();
		expect(source.readAgentPlugins()?.skillPathContributions?.[0]).toEqual({
			pluginId: "updated",
			paths: ["C:/plugins/updated"],
		});
	});

	it("fails closed when the Renderer tool invoker is not attached", async () => {
		const source = new DesktopCodingAgentPluginRuntimeSource({
			build: () => undefined,
			additionalSkillPaths: [],
			handlerLeaseProvider: { bindForTurn: () => ({ release() {} }) },
		});

		await expect(
			source.invokeTool(
				{
					pluginId: "plugin-a",
					toolId: "tool-a",
					toolName: "plugin_tool",
					handlerId: "handler-a",
					input: {},
					session: { id: "session-a", cwd: "C:/workspace", scenario: "conversation" },
					model: { provider: "test", id: "model", api: "openai-responses", input: ["text"] },
					conversation: { messages: [], messageCount: 0 },
					runtime: { activeToolNames: [], availableToolNames: [], runIndex: 0 },
					trigger: { kind: "tool-call", timestamp: 1, toolCallId: "call-a" },
				},
				undefined,
			),
		).rejects.toThrow("Desktop Plugin tool host is unavailable");
	});

	it("refreshes built-in Skill paths when a new preset appears after startup", () => {
		let paths = ["C:/vetta/builtin-skills/create-skill"];
		const source = new DesktopCodingAgentPluginRuntimeSource({
			build: () => configuration("initial"),
			additionalSkillPaths: paths,
			readAdditionalSkillPaths: () => paths,
			handlerLeaseProvider: { bindForTurn: () => ({ release() {} }) },
		});
		const listener = vi.fn();
		source.subscribe(listener);
		expect(source.readAgentPlugins()?.skillPathContributions?.at(-1)?.paths).toEqual(paths);

		paths = ["C:/vetta/builtin-skills/create-skill", "C:/vetta/builtin-skills/vetta-blog"];
		expect(source.readAgentPlugins()?.skillPathContributions?.at(-1)?.paths).toEqual(paths);
		expect(listener).toHaveBeenCalledOnce();
	});
});

function configuration(pluginId: string): AgentPluginRuntimeConfig {
	return {
		skillPathContributions: [{ pluginId, paths: [`C:/plugins/${pluginId}`] }],
	};
}
