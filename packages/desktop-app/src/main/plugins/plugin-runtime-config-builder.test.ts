import { describe, expect, it, vi } from "vitest";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";
import { DesktopPluginHookRegistry } from "./coding-agent-hook-registry.js";
import { PluginAgentContributionRegistry } from "./plugin-agent-contribution-registry.js";
import { buildPluginRuntimeConfig } from "./plugin-runtime-config-builder.js";

function plugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
	return {
		id: "demo",
		name: "Demo",
		version: "1.0.0",
		activeVersion: "1.0.0",
		pluginApiVersion: "^1.0.0",
		runtime: "esm",
		entryUrl: "vetta-plugin://demo/index.js",
		styleUrls: [],
		permissions: ["agent.tools.register", "agent.toolHandler.execute"],
		grantedPermissions: ["agent.tools.register", "agent.toolHandler.execute"],
		allowedNetworkHosts: [],
		declaredCommands: [],
		grantedCommandNames: [],
		defaultLocale: "zh",
		locales: {},
		enabled: true,
		required: false,
		installedAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		source: "archive",
		trustLevel: "local",
		rootPath: "C:/plugins/demo",
		...overrides,
	};
}

describe("buildPluginRuntimeConfig", () => {
	it("combines mode, contribution gate, permission and dynamic registration filters", () => {
		const contributions = new PluginAgentContributionRegistry(new DesktopPluginHookRegistry());
		contributions.beginLoad("demo", "activation");
		contributions.registerTool("demo", {
			id: "tool",
			name: "demo_tool",
			description: "Demo tool",
			parameters: {},
			handlerId: "handler",
			activationId: "activation",
		});
		contributions.commit("demo", "activation");
		const logger = { debug: vi.fn(), warn: vi.fn() };

		const visible = buildPluginRuntimeConfig({
			plugins: [plugin({ agent_mode: ["work"] })],
			agentMode: "work",
			isContributionModeActive: () => true,
			contributions,
			resolveResource: (_plugin, path) => path,
			resolveMcpRoot: (value) => value.rootPath,
			logger,
		});
		expect(visible?.toolContributions).toEqual([expect.objectContaining({ pluginId: "demo", name: "demo_tool" })]);

		const hidden = buildPluginRuntimeConfig({
			plugins: [plugin({ agent_mode: ["work"] })],
			agentMode: "coding",
			isContributionModeActive: () => true,
			contributions,
			resolveResource: (_plugin, path) => path,
			resolveMcpRoot: (value) => value.rootPath,
			logger,
		});
		expect(hidden).toBeUndefined();
	});
});
