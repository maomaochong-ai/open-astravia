import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import {
	createMcpRuntimeToolSynchronizer,
	type McpRuntimeToolBinding,
	type McpRuntimeToolRegistry,
	type McpRuntimeToolView,
} from "../src/index.js";

describe("McpRuntimeToolSynchronizer", () => {
	it("updates only changed bindings while preserving unchanged tools", async () => {
		const alphaV1 = tool("mcp_search_alpha", "Alpha");
		const beta = tool("mcp_search_beta", "Beta");
		let view = runtimeView(binding(alphaV1, "alpha-v1"), binding(beta, "beta-v1"));
		const source = { refresh: vi.fn(async () => view) };
		const registry = new RecordingRegistry();
		const synchronizer = createMcpRuntimeToolSynchronizer(source, registry);

		const first = await synchronizer.refresh();
		expect(first).toEqual({
			revision: 1,
			tools: [
				{ name: "mcp_search_alpha", description: "Alpha" },
				{ name: "mcp_search_beta", description: "Beta" },
			],
		});
		expect(registry.registered.get(alphaV1.name)).toBe(alphaV1);
		expect(synchronizer.view()).toEqual(view);

		view = runtimeView(binding(tool("mcp_search_alpha", "Alpha"), "alpha-v1"), binding(beta, "beta-v1"));
		const unchanged = await synchronizer.refresh();
		expect(unchanged).toBe(first);
		expect(synchronizer.view()).toEqual(view);
		expect(registry.registerCalls).toEqual(["mcp_search_alpha", "mcp_search_beta"]);
		expect(registry.registered.get(alphaV1.name)).toBe(alphaV1);

		const alphaV2 = tool("mcp_search_alpha", "Alpha");
		const gamma = tool("mcp_search_gamma", "Gamma");
		view = runtimeView(binding(alphaV2, "alpha-v2"), binding(gamma, "gamma-v1"));
		const changed = await synchronizer.refresh();

		expect(changed.revision).toBe(2);
		expect(registry.unregisterCalls).toEqual(["mcp_search_beta", "mcp_search_alpha"]);
		expect(registry.registered.get(alphaV1.name)).toBe(alphaV2);
		expect(registry.registered.has(beta.name)).toBe(false);
		expect(registry.registered.get(gamma.name)).toBe(gamma);
	});

	it("keeps the current registry and view when source refresh fails", async () => {
		const alpha = tool("mcp_search_alpha", "Alpha");
		let failure: Error | undefined;
		const source = {
			async refresh() {
				if (failure) throw failure;
				return runtimeView(binding(alpha, "alpha-v1"));
			},
		};
		const registry = new RecordingRegistry();
		const synchronizer = createMcpRuntimeToolSynchronizer(source, registry);
		const initial = await synchronizer.refresh();

		failure = new Error("MCP refresh failed");
		await expect(synchronizer.refresh()).rejects.toThrow("MCP refresh failed");

		expect(synchronizer.snapshot()).toBe(initial);
		expect(synchronizer.view()).toEqual(runtimeView(binding(alpha, "alpha-v1")));
		expect(registry.registered.get(alpha.name)).toBe(alpha);
		expect(registry.unregisterCalls).toEqual([]);
	});

	it("deduplicates concurrent refreshes and unregisters managed tools on dispose", async () => {
		const alpha = tool("mcp_search_alpha", "Alpha");
		let resolveRefresh: ((view: McpRuntimeToolView) => void) | undefined;
		const pending = new Promise<McpRuntimeToolView>((resolve) => {
			resolveRefresh = resolve;
		});
		const source = { refresh: vi.fn(async () => await pending) };
		const registry = new RecordingRegistry();
		const synchronizer = createMcpRuntimeToolSynchronizer(source, registry);

		const first = synchronizer.refresh();
		const second = synchronizer.refresh();
		resolveRefresh?.(runtimeView(binding(alpha, "alpha-v1")));

		expect(await first).toEqual(await second);
		expect(source.refresh).toHaveBeenCalledOnce();
		synchronizer.dispose();
		expect(registry.unregisterCalls).toEqual([alpha.name]);
		expect(synchronizer.snapshot()).toEqual({ revision: 2, tools: [] });
		expect(synchronizer.view()).toEqual({ tools: [] });
	});
});

class RecordingRegistry implements McpRuntimeToolRegistry {
	readonly registered = new Map<string, RuntimeToolDefinition>();
	readonly registerCalls: string[] = [];
	readonly unregisterCalls: string[] = [];

	register(runtimeTool: RuntimeToolDefinition): void {
		this.registerCalls.push(runtimeTool.name);
		this.registered.set(runtimeTool.name, runtimeTool);
	}

	unregister(toolName: string): boolean {
		this.unregisterCalls.push(toolName);
		return this.registered.delete(toolName);
	}
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

function binding(runtimeTool: RuntimeToolDefinition, fingerprint: string): McpRuntimeToolBinding {
	return { tool: runtimeTool, fingerprint };
}

function runtimeView(...tools: readonly McpRuntimeToolBinding[]): McpRuntimeToolView {
	return { tools };
}
