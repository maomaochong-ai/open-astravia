import { describe, expect, it, vi } from "vitest";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";
import { DesktopPluginHookRegistry } from "./coding-agent-hook-registry.js";
import { PluginAgentContributionRegistry } from "./plugin-agent-contribution-registry.js";
import { clearPluginCliProviderReadiness, setPluginCliProviderReady } from "./plugin-cli-provider-readiness.js";
import { buildPluginRuntimeConfig } from "./plugin-runtime-config-builder.js";

function plugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
	return {
		id: "demo",
		name: "Demo",
		version: "1.0.0",
		activeVersion: "1.0.0",
		pluginApiVersion: "^2.0.0",
		moduleFederation: { remoteName: "runtime_config_test", expose: "./plugin" },
		entryUrl: "vetta-plugin://demo/index.js",
		styleUrls: [],
		permissions: ["agent.tools.register", "agent.toolHandler.execute"],
		grantedPermissions: ["agent.tools.register", "agent.toolHandler.execute"],
		allowedNetworkHosts: [],
		allowedBrowserHosts: [],
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
	it("withholds all agent contributions until every declared CLI provider is ready", () => {
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
		const dependencies = {
			plugins: [
				plugin({ cliProviders: [{ id: "required-cli", command: "required-cli", install: { command: "npx" } }] }),
			],
			isContributionModeActive: () => true,
			contributions,
			resolveResource: (_plugin: InstalledPlugin, path: string) => path,
			resolveMcpRoot: (value: InstalledPlugin) => value.rootPath,
			logger: { debug: vi.fn(), warn: vi.fn() },
		};

		clearPluginCliProviderReadiness("demo");
		expect(buildPluginRuntimeConfig(dependencies)).toBeUndefined();
		setPluginCliProviderReady("demo", "required-cli", true);
		expect(buildPluginRuntimeConfig(dependencies)?.toolContributions).toHaveLength(1);
		clearPluginCliProviderReadiness("demo");
	});

	it("keeps contributions of plugins whose declared agent_mode does not match the current mode", () => {
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

		const config = buildPluginRuntimeConfig({
			plugins: [plugin()],
			isContributionModeActive: () => true,
			contributions,
			resolveResource: (_plugin, path) => path,
			resolveMcpRoot: (value) => value.rootPath,
			logger,
		});
		expect(config?.toolContributions).toEqual([expect.objectContaining({ pluginId: "demo", name: "demo_tool" })]);
	});

	it("still applies the contribution gate and permission filters", () => {
		const contributions = new PluginAgentContributionRegistry(new DesktopPluginHookRegistry());
		contributions.registerTool("demo", {
			id: "tool",
			name: "demo_tool",
			description: "Demo tool",
			parameters: {},
			handlerId: "handler",
		});
		const logger = { debug: vi.fn(), warn: vi.fn() };
		const shared = {
			contributions,
			resolveResource: (_plugin: InstalledPlugin, path: string) => path,
			resolveMcpRoot: (value: InstalledPlugin) => value.rootPath,
			logger,
		};

		expect(
			buildPluginRuntimeConfig({
				...shared,
				plugins: [plugin()],
				isContributionModeActive: () => false,
			}),
		).toBeUndefined();
		expect(
			buildPluginRuntimeConfig({
				...shared,
				plugins: [plugin({ grantedPermissions: [] })],
				isContributionModeActive: () => true,
			}),
		).toBeUndefined();
	});

	it("passes skill presentation to discovery without changing the runtime path", () => {
		const contributions = new PluginAgentContributionRegistry(new DesktopPluginHookRegistry());
		const config = buildPluginRuntimeConfig({
			plugins: [
				plugin({
					permissions: ["agent.skills.control"],
					grantedPermissions: ["agent.skills.control"],
					agent: {
						skillPaths: ["agent/skills"],
						skillPresentation: {
							defaultVisibility: "hidden",
							skills: {
								design: { defaultVisibility: "visible", displayName: "%skill.design.name%" },
							},
						},
					},
				}),
			],
			isContributionModeActive: () => true,
			contributions,
			resolveResource: (_plugin, path) => `C:/plugins/demo/${path}`,
			resolveMcpRoot: (value) => value.rootPath,
			logger: { debug: vi.fn(), warn: vi.fn() },
		});

		expect(config?.skillPathContributions).toEqual([
			{
				pluginId: "demo",
				paths: ["C:/plugins/demo/agent/skills"],
				presentation: {
					defaultVisibility: "hidden",
					skills: {
						design: { defaultVisibility: "visible", displayName: "%skill.design.name%" },
					},
				},
			},
		]);
	});

	it("defers a service MCP quietly until its managed service is ready", () => {
		const contributions = new PluginAgentContributionRegistry(new DesktopPluginHookRegistry());
		const logger = { debug: vi.fn(), warn: vi.fn() };
		const resolveServiceMcp = vi.fn<() => string | undefined>().mockReturnValue(undefined);
		const servicePlugin = plugin({
			permissions: ["agent.mcp.control"],
			grantedPermissions: ["agent.mcp.control"],
			agent: {
				mcpServers: {
					xiaohongshu: {
						type: "service",
						serviceId: "xhs",
						path: "/mcp",
					},
				},
			},
		});
		const dependencies = {
			plugins: [servicePlugin],
			isContributionModeActive: () => true,
			contributions,
			resolveResource: (_plugin: InstalledPlugin, path: string) => path,
			resolveMcpRoot: (value: InstalledPlugin) => value.rootPath,
			resolveServiceMcp,
			logger,
		};

		expect(buildPluginRuntimeConfig(dependencies)).toBeUndefined();
		expect(logger.warn).not.toHaveBeenCalled();
		expect(logger.debug).toHaveBeenCalledWith(
			"defer mcp contribution: plugin service is not ready",
			expect.objectContaining({ pluginId: "demo", localName: "xiaohongshu", serviceId: "xhs" }),
		);

		resolveServiceMcp.mockReturnValue("http://127.0.0.1:57341/mcp");
		expect(buildPluginRuntimeConfig(dependencies)?.mcpServerContributions).toEqual([
			expect.objectContaining({
				pluginId: "demo",
				localName: "xiaohongshu",
				runtimeName: "plugin-demo-xiaohongshu",
				config: expect.objectContaining({ url: "http://127.0.0.1:57341/mcp" }),
			}),
		]);
	});
});
