import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import {
	createMcpRuntimeToolSynchronizer,
	createMcpServerRuntimeToolSource,
	type McpClientHandle,
	type McpInitializeResult,
	type McpPromptsListResult,
	type McpResourceReadResult,
	type McpResourcesListResult,
	type McpRuntimeToolRegistry,
	type McpServerBinding,
	type McpServerRuntimePort,
	type McpToolsListResult,
} from "../src/index.js";

describe("McpServerRuntimeToolSource", () => {
	it("publishes ready server tools directly with product decoration", async () => {
		const client = new FakeClient();
		const port = new MutableServerRuntimePort([binding(client, 1)]);
		const source = createMcpServerRuntimeToolSource(port, {
			decorateTool: (tool, context) => ({ ...tool, productMetadata: context }),
		});

		const view = await source.refresh();
		const published = view.tools[0];

		expect(port.reloadIfChanged).toHaveBeenCalledOnce();
		expect(published?.tool).toMatchObject({
			name: "mcp_search_lookup",
			label: "search: lookup",
			description: "Lookup a value",
			productMetadata: { serverName: "search", toolName: "lookup" },
		});
		expect(published?.fingerprint).toContain('"server":"search"');
		expect(published?.fingerprint).toContain('"startedAt":1');
		const result = await published?.tool.execute({
			sessionId: "session",
			turnId: "turn",
			toolCallId: "call",
			input: { query: "value" },
			signal: new AbortController().signal,
		});
		expect(client.calls).toEqual([{ name: "lookup", input: { query: "value" } }]);
		expect(result).toEqual({
			content: [{ type: "text", text: "result" }],
			details: { content: [{ type: "text", text: "result" }] },
		});
	});

	it("keeps unchanged bindings and replaces only a reconnected server", async () => {
		const firstClient = new FakeClient();
		const port = new MutableServerRuntimePort([binding(firstClient, 1)]);
		const registry = new RecordingRegistry();
		const synchronizer = createMcpRuntimeToolSynchronizer(createMcpServerRuntimeToolSource(port), registry);

		await synchronizer.refresh();
		await synchronizer.refresh();
		expect(registry.registerCalls).toEqual(["mcp_search_lookup"]);
		expect(registry.unregisterCalls).toEqual([]);

		port.bindings = [binding(new FakeClient(), 2)];
		await synchronizer.refresh();
		expect(registry.registerCalls).toEqual(["mcp_search_lookup", "mcp_search_lookup"]);
		expect(registry.unregisterCalls).toEqual(["mcp_search_lookup"]);

		port.bindings = [];
		await synchronizer.refresh();
		expect(registry.unregisterCalls).toEqual(["mcp_search_lookup", "mcp_search_lookup"]);
		expect(synchronizer.snapshot()).toEqual({ revision: 2, tools: [] });
	});

	it("preserves the existing successful error result", async () => {
		const client = new FakeClient(new Error("remote failed"));
		const source = createMcpServerRuntimeToolSource(new MutableServerRuntimePort([binding(client, 1)]));
		const tool = (await source.refresh()).tools[0]?.tool;

		await expect(
			tool?.execute({
				sessionId: "session",
				turnId: "turn",
				toolCallId: "call",
				input: {},
				signal: new AbortController().signal,
			}),
		).resolves.toEqual({
			content: [{ type: "text", text: "Error calling MCP tool 'lookup': remote failed" }],
			details: {
				content: [{ type: "text", text: "remote failed" }],
				isError: true,
			},
		});
	});

	it("propagates a leased generation failure instead of falling through to a replacement", async () => {
		const retiredClient = new FakeClient(new Error("retired transport failed"));
		const replacementClient = new FakeClient();
		const port = new MutableServerRuntimePort([binding(retiredClient, 1)]);
		const source = createMcpServerRuntimeToolSource(port);
		const published = (await source.refresh()).tools[0]?.tool;
		const turnBinding = published?.bindForTurn?.({
			sessionId: "session",
			operationId: "turn",
			reason: "turn",
			signal: new AbortController().signal,
		});
		expect(turnBinding).toBeDefined();

		port.bindings = [binding(replacementClient, 2)];
		await source.refresh();
		const result = await turnBinding?.tool.execute({
			sessionId: "session",
			turnId: "turn",
			toolCallId: "call",
			input: { query: "value" },
			signal: new AbortController().signal,
		});
		await turnBinding?.release();

		expect(result).toEqual({
			content: [{ type: "text", text: "Error calling MCP tool 'lookup': retired transport failed" }],
			details: {
				content: [{ type: "text", text: "retired transport failed" }],
				isError: true,
			},
		});
		expect(retiredClient.calls).toEqual([{ name: "lookup", input: { query: "value" } }]);
		expect(replacementClient.calls).toEqual([]);
	});
});

class MutableServerRuntimePort implements McpServerRuntimePort {
	readonly reloadIfChanged = vi.fn(async () => false);

	constructor(public bindings: McpServerBinding[]) {}

	getReadyServerBindings(): readonly McpServerBinding[] {
		return this.bindings;
	}
}

class FakeClient implements McpClientHandle {
	readonly calls: Array<{ readonly name: string; readonly input: unknown }> = [];

	constructor(private readonly callError?: Error) {}

	async initialize(): Promise<McpInitializeResult> {
		throw new Error("Not used");
	}

	async listTools(): Promise<McpToolsListResult> {
		throw new Error("Not used");
	}

	async callTool(name: string, input?: Record<string, unknown>) {
		this.calls.push({ name, input });
		if (this.callError) throw this.callError;
		return { content: [{ type: "text" as const, text: "result" }] };
	}

	async listResources(): Promise<McpResourcesListResult> {
		throw new Error("Not used");
	}

	async readResource(): Promise<McpResourceReadResult> {
		throw new Error("Not used");
	}

	async listPrompts(): Promise<McpPromptsListResult> {
		throw new Error("Not used");
	}

	async close() {}

	getName(): string {
		return "search";
	}

	getPid(): number | undefined {
		return undefined;
	}

	isClientInitialized(): boolean {
		return true;
	}
}

class RecordingRegistry implements McpRuntimeToolRegistry {
	readonly tools = new Map<string, RuntimeToolDefinition>();
	readonly registerCalls: string[] = [];
	readonly unregisterCalls: string[] = [];

	register(tool: RuntimeToolDefinition): void {
		this.registerCalls.push(tool.name);
		this.tools.set(tool.name, tool);
	}

	unregister(toolName: string): boolean {
		this.unregisterCalls.push(toolName);
		return this.tools.delete(toolName);
	}
}

function binding(client: McpClientHandle, startedAt: number): McpServerBinding {
	const view: McpServerBinding["view"] = {
		name: "search",
		config: { command: "search" },
		status: "ready",
		startedAt,
		tools: [
			{
				name: "lookup",
				description: "Lookup a value",
				inputSchema: { type: "object", properties: { query: { type: "string" } } },
			},
		],
		resources: [],
	};
	return {
		client,
		view,
		acquireLease: () => ({ client, view, release: async () => {} }),
	};
}
