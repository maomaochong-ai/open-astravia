import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import type { McpDynamicServerSet, McpServerBinding } from "../src/server/index.js";
import { createMcpDynamicServerRuntimeToolSource, type McpDynamicServerRuntimePort } from "../src/tools/index.js";

describe("McpDynamicServerRuntimeToolSource", () => {
	it("exposes complete dynamic replacement without exposing Supervisor lifecycle", async () => {
		const port = new FakeDynamicServerPort();
		const source = createMcpDynamicServerRuntimeToolSource(port);
		const next: McpDynamicServerSet = {
			servers: new Map([["plugin-alpha-docs", { command: "alpha" }]]),
			signature: "alpha",
		};

		expect(await source.replaceDynamicServers(next)).toBe(true);
		expect(port.setDynamicServers).toHaveBeenCalledWith(next);
		expect(await source.refresh()).toEqual({ tools: [] });
		expect(port.reloadIfChanged).toHaveBeenCalledOnce();
	});

	it("uses the same Runtime Tool projection as the read-only Server source", async () => {
		const tool: RuntimeToolDefinition = {
			name: "unused",
			label: "unused",
			description: "unused",
			inputSchema: { type: "object" },
			execute: async () => ({ content: [{ type: "text", text: "unused" }], details: {} }),
		};
		const port = new FakeDynamicServerPort([
			{
				view: {
					name: "plugin-alpha-docs",
					config: { command: "alpha" },
					status: "ready",
					tools: [{ name: "search", description: "Search docs", inputSchema: { type: "object" } }],
					resources: [],
					startedAt: 10,
				},
				client: {
					initialize: async () => ({ protocolVersion: "test", serverInfo: { name: "test", version: "1" } }),
					listTools: async () => ({ tools: [] }),
					callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
					listResources: async () => ({ resources: [] }),
					readResource: async () => ({ contents: [] }),
					listPrompts: async () => ({ prompts: [] }),
					close: async () => {},
					getName: () => "test",
					getPid: () => undefined,
					isClientInitialized: () => true,
				},
				acquireLease() {
					return { client: this.client, view: this.view, release: async () => {} };
				},
			},
		]);
		const source = createMcpDynamicServerRuntimeToolSource(port, {
			decorateTool: (runtimeTool) => ({ ...runtimeTool, label: tool.label }),
		});

		const view = await source.refresh();

		expect(view.tools).toHaveLength(1);
		expect(view.tools[0]?.tool).toMatchObject({
			name: "mcp_plugin-alpha-docs_search",
			label: "unused",
			description: "Search docs",
		});
		await expect(
			view.tools[0]?.tool.execute({
				sessionId: "session",
				turnId: "turn",
				toolCallId: "call",
				input: {},
				signal: new AbortController().signal,
			}),
		).resolves.toEqual({
			content: [{ type: "text", text: "ok" }],
			details: { content: [{ type: "text", text: "ok" }] },
		});
	});
});

class FakeDynamicServerPort implements McpDynamicServerRuntimePort {
	readonly setDynamicServers = vi.fn(async () => true);
	readonly reloadIfChanged = vi.fn(async () => false);

	constructor(private readonly bindings: readonly McpServerBinding[] = []) {}

	getReadyServerBindings(): readonly McpServerBinding[] {
		return this.bindings;
	}
}
