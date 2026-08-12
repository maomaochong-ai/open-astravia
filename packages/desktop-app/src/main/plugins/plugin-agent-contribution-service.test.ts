import { describe, expect, it, vi } from "vitest";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";
import { DesktopPluginAgentHandlerRegistry } from "./coding-agent-handler-registry.js";
import type { DesktopPluginHookRegistry } from "./coding-agent-hook-registry.js";
import { PluginAgentContributionService } from "./plugin-agent-contribution-service.js";

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
		permissions: ["agent.hooks.register", "agent.hookHandler.execute", "agent.tools.register"],
		grantedPermissions: ["agent.hooks.register", "agent.hookHandler.execute", "agent.tools.register"],
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

function createService(installed: InstalledPlugin) {
	const hooks = {
		register: vi.fn(),
		unregister: vi.fn(() => true),
		clear: vi.fn(),
		count: vi.fn(() => 0),
	} as unknown as DesktopPluginHookRegistry;
	return new PluginAgentContributionService({
		listPlugins: () => [installed],
		isDevLinked: () => false,
		resolveFilePath: (_pluginId, relativePath) => relativePath,
		logger: { debug: vi.fn(), warn: vi.fn() },
		hooks,
		handlers: new DesktopPluginAgentHandlerRegistry(),
	});
}

describe("PluginAgentContributionService", () => {
	it("applies the contribution mode gate before hook invocation", () => {
		const service = createService(plugin());
		service.registerModeGate("demo");
		expect(service.canInvokeHook("demo")).toBe(false);

		service.setContributionMode("demo", true);
		expect(service.canInvokeHook("demo")).toBe(true);
	});

	it("never gates hook invocation on any agent mode notion", () => {
		// 工作模式不参与 hook 过滤（ADR-0071），服务不持有「当前模式」这个可过滤的状态。
		const service = createService(plugin());

		expect(service.canInvokeHook("demo")).toBe(true);
		expect("setAgentMode" in service).toBe(false);
	});

	it("rejects tool registration when the permission is not granted", () => {
		const service = createService(plugin({ grantedPermissions: [] }));

		expect(() =>
			service.registerTool("demo", {
				id: "tool",
				name: "demo_tool",
				description: "Demo tool",
				parameters: { type: "object" },
				handlerId: "handler",
			}),
		).toThrow("Plugin permission denied: agent.tools.register");
	});
});
