import type { GreenfieldRuntimeResourceContext } from "@vetta/runtime-core";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type {
	McpRuntimeToolBinding,
	McpRuntimeToolRegistry,
	McpRuntimeToolSnapshot,
	McpRuntimeToolView,
} from "@vetta/runtime-mcp";
import { describe, expect, it, vi } from "vitest";
import type { CodingAgentPluginMcpRuntime } from "../../src/adapters/runtime-core/greenfield-plugin-mcp-runtime.js";
import { CodingAgentCompositionResourceRegistry } from "../../src/composition/session-lifecycle/resource-registry.js";
import { createCodingAgentMcpSessionCoordinator } from "../../src/composition/tool-surface/mcp-session-coordinator.js";

describe("Coding Agent MCP Session Coordinator", () => {
	it("merges shared and plugin MCP state for Session controllers and Subagent inheritance", async () => {
		const sharedBase = tool("mcp_shared", "shared base");
		const sharedPlugin = tool("mcp_shared", "shared plugin");
		const baseOnly = tool("mcp_base", "base only");
		const pluginOnly = tool("mcp_plugin", "plugin only");
		const source = {
			refresh: vi.fn(async () => runtimeView(binding(sharedBase, "base-shared"), binding(baseOnly, "base-only"))),
		};
		const plugin = pluginRuntime(
			{ revision: 5, tools: descriptors(sharedPlugin, pluginOnly) },
			runtimeView(binding(sharedPlugin, "plugin-shared"), binding(pluginOnly, "plugin-only")),
		);
		const registry = new RecordingRegistry();
		const resources = new CodingAgentCompositionResourceRegistry();
		const coordinator = await createCodingAgentMcpSessionCoordinator({
			source,
			registry,
			indexes: resources.indexes,
		});

		const controller = coordinator.createSessionController({
			sessionId: "session",
			activation: { mode: "scope", scope: "cli" },
			pluginRuntime: plugin.runtime,
		});
		expect(controller?.readPromptState().tools).toEqual([
			{ name: "mcp_shared", description: "shared plugin" },
			{ name: "mcp_base", description: "base only" },
			{ name: "mcp_plugin", description: "plugin only" },
		]);

		const inherited = await coordinator.readInheritedToolView(plugin.runtime);
		expect(inherited.tools.map(({ tool: inheritedTool }) => inheritedTool.name)).toEqual([
			"mcp_shared",
			"mcp_base",
			"mcp_plugin",
		]);
		expect(inherited.tools[0]?.tool).toBe(sharedPlugin);
		expect(source.refresh).toHaveBeenCalledTimes(2);
		expect(plugin.refresh).toHaveBeenCalledOnce();

		coordinator.dispose();
		expect(registry.unregisterCalls).toEqual(["mcp_shared", "mcp_base"]);
	});

	it("reports prompt-boundary refreshes, updates controllers and reuses the same refresh once", async () => {
		const alpha = tool("mcp_alpha", "alpha");
		const beta = tool("mcp_beta", "beta");
		let currentView = runtimeView(binding(alpha, "alpha"));
		let refreshFailure: Error | undefined;
		const source = {
			refresh: vi.fn(async () => {
				if (refreshFailure) throw refreshFailure;
				return currentView;
			}),
		};
		const resources = new CodingAgentCompositionResourceRegistry();
		const coordinator = await createCodingAgentMcpSessionCoordinator({
			source,
			registry: new RecordingRegistry(),
			indexes: resources.indexes,
		});
		const observations: Array<{
			readonly type: string;
			readonly changed?: boolean;
			readonly errorMessage?: string;
		}> = [];
		resources.indexes.resourceContexts.set("session", {
			reportObservation: async (event: {
				readonly type: string;
				readonly changed?: boolean;
				readonly errorMessage?: string;
			}) => {
				observations.push(event);
			},
		} as unknown as GreenfieldRuntimeResourceContext);
		const controller = coordinator.createSessionController({
			sessionId: "session",
			activation: { mode: "scope", scope: "cli" },
		});
		if (!controller) throw new Error("Expected shared MCP controller");
		resources.indexes.mcpControllers.set("session", controller);

		currentView = runtimeView(binding(beta, "beta"));
		await coordinator.refreshSession("session", true);
		expect(controller.readPromptState().tools).toEqual([{ name: "mcp_beta", description: "beta" }]);
		expect(observations).toEqual([
			{ type: "mcp.reload.start", source: "agent" },
			{ type: "mcp.reload.end", changed: true, source: "agent" },
		]);
		expect(source.refresh).toHaveBeenCalledTimes(2);

		await coordinator.refreshCatalogForModelCall("session");
		expect(source.refresh).toHaveBeenCalledTimes(2);
		await coordinator.refreshCatalogForModelCall("session");
		expect(source.refresh).toHaveBeenCalledTimes(3);

		refreshFailure = new Error("refresh failed");
		await expect(coordinator.refreshSession("session", true)).rejects.toBe(refreshFailure);
		expect(observations.slice(2)).toEqual([
			{ type: "mcp.reload.start", source: "agent" },
			{ type: "mcp.reload.end", changed: false, errorMessage: "refresh failed", source: "agent" },
		]);
	});

	it("unregisters partially initialized shared tools when the initial synchronization fails", async () => {
		const first = tool("mcp_first", "first");
		const second = tool("mcp_second", "second");
		const registry = new RecordingRegistry("mcp_second");
		const resources = new CodingAgentCompositionResourceRegistry();

		await expect(
			createCodingAgentMcpSessionCoordinator({
				source: {
					refresh: async () => runtimeView(binding(first, "first"), binding(second, "second")),
				},
				registry,
				indexes: resources.indexes,
			}),
		).rejects.toThrow("registration failed");
		expect(registry.unregisterCalls).toEqual(["mcp_first"]);
		expect(registry.registered.size).toBe(0);
	});
});

class RecordingRegistry implements McpRuntimeToolRegistry {
	readonly registered = new Map<string, RuntimeToolDefinition>();
	readonly unregisterCalls: string[] = [];

	constructor(private readonly failingToolName?: string) {}

	register(runtimeTool: RuntimeToolDefinition): void {
		if (runtimeTool.name === this.failingToolName) throw new Error("registration failed");
		this.registered.set(runtimeTool.name, runtimeTool);
	}

	unregister(toolName: string): boolean {
		this.unregisterCalls.push(toolName);
		return this.registered.delete(toolName);
	}
}

function pluginRuntime(snapshot: McpRuntimeToolSnapshot, view: McpRuntimeToolView) {
	const refresh = vi.fn(async () => snapshot);
	return {
		refresh,
		runtime: {
			refresh,
			snapshot: () => snapshot,
			view: () => view,
		} as unknown as CodingAgentPluginMcpRuntime,
	};
}

function tool(name: string, description: string): RuntimeToolDefinition {
	return {
		name,
		label: name,
		description,
		inputSchema: { type: "object" },
		execute: async () => ({ content: [{ type: "text", text: name }] }),
	};
}

function descriptors(...tools: readonly RuntimeToolDefinition[]) {
	return tools.map(({ name, description }) => ({ name, description }));
}

function binding(runtimeTool: RuntimeToolDefinition, fingerprint: string): McpRuntimeToolBinding {
	return { tool: runtimeTool, fingerprint };
}

function runtimeView(...tools: readonly McpRuntimeToolBinding[]): McpRuntimeToolView {
	return { tools };
}
