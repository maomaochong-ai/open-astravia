import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_CONFIGURATION } from "../../src/agent-configuration/configuration-schema.js";
import {
	createAgentToolSelection,
	filterAgentTools,
	selectAgentPlugins,
	validateAgentResourceSelection,
} from "../../src/agent-configuration/resource-selection.js";
import type { AgentPluginRuntimeConfig } from "../../src/model-context/plugin-runtime.js";

describe("Agent resource restrictions", () => {
	it("intersects the host tool surface and freezes explicit MCP identities without parsing tool names", () => {
		const configuration = {
			...DEFAULT_AGENT_CONFIGURATION,
			tools: ["read", "arbitrary-name", "looks_like_mcp", "missing-origin"],
			mcpServers: ["allowed"],
		};
		const allows = createAgentToolSelection(configuration, [
			{ name: "arbitrary-name", description: "", serverName: "denied" },
			{ name: "looks_like_mcp", description: "", serverName: "allowed" },
			{ name: "missing-origin", description: "" },
		]);
		const tool = (name: string): RuntimeToolDefinition => ({
			name,
			label: name,
			description: "",
			inputSchema: {},
			execute: async () => ({ content: [] }),
		});
		const available = new Map(
			["read", "write", "arbitrary-name", "looks_like_mcp", "missing-origin"].map((name) => [name, tool(name)]),
		);
		expect([...filterAgentTools(available, allows).keys()]).toEqual(["read", "looks_like_mcp"]);
		expect([...filterAgentTools(new Map(), allows).keys()]).toEqual([]);
		expect(createAgentToolSelection({ ...DEFAULT_AGENT_CONFIGURATION, tools: [] }, [])("read")).toBe(false);
	});

	it("filters every plugin contribution kind, not only plugin tools", () => {
		const config: AgentPluginRuntimeConfig = {
			skillPathContributions: [
				{ pluginId: "allowed", paths: ["skill"] },
				{ pluginId: "denied", paths: ["private"] },
			],
			toolPolicyContributions: [{ pluginId: "denied", allow: ["write"] }],
			stateContributions: [{ pluginId: "denied", id: "state" }],
			continuationContributions: [{ pluginId: "denied", id: "continue", handlerId: "handler" }],
			systemPromptProviderContributions: [{ pluginId: "denied", id: "prompt", handlerId: "handler" }],
			mcpServerContributions: [
				{ pluginId: "denied", localName: "server", runtimeName: "server", config: { command: "unused" } },
			],
		};
		const filtered = selectAgentPlugins(config, ["allowed"]);
		expect(filtered?.skillPathContributions).toEqual([{ pluginId: "allowed", paths: ["skill"] }]);
		expect(JSON.stringify(filtered)).not.toContain("denied");
		expect(selectAgentPlugins(config, null)).toBe(config);
	});

	it.each(["skills", "tools", "mcpServers", "plugins", "modelKey"] as const)(
		"rejects an unavailable explicit %s instead of falling back to all resources",
		(kind) => {
			const configuration = {
				...DEFAULT_AGENT_CONFIGURATION,
				[kind]: kind === "modelKey" ? "absent/model" : ["absent"],
			};
			expect(() =>
				validateAgentResourceSelection(configuration, {
					skills: [],
					tools: [],
					mcpServers: [],
					plugins: [],
					models: [],
				}),
			).toThrow("AGENT_CONFIGURATION_RESOURCE_UNAVAILABLE");
		},
	);
});
