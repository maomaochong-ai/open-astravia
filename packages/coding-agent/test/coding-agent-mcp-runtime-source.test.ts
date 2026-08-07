import type {
	McpClientHandle,
	McpConfig,
	McpConfigSource,
	McpServerConfig,
	RuntimeMcpClientFactory,
	RuntimeMcpClientFactoryOptions,
} from "@vetta/runtime-mcp";
import { describe, expect, it, vi } from "vitest";
import type { EcosystemHookAwareRuntimeTool } from "../src/adapters/runtime-core/ecosystem-hook-tool-wrapper.js";
import { createCodingAgentMcpRuntimeToolSource } from "../src/mcp/runtime/tool-source.js";

describe("Coding Agent native MCP runtime source", () => {
	it("composes product client options, hook metadata and lifecycle without a legacy Manager", async () => {
		const source = new StaticConfigSource({ search: { command: "search", debug: true } });
		const client = new FakeClient();
		const created: Array<{
			readonly name: string;
			readonly config: McpServerConfig;
			readonly options: RuntimeMcpClientFactoryOptions | undefined;
		}> = [];
		const clientFactory: RuntimeMcpClientFactory = (name, config, options) => {
			created.push({ name, config, options });
			return client;
		};
		const managed = await createCodingAgentMcpRuntimeToolSource({
			configSource: source,
			clientFactory,
			agentDir: "C:/native-mcp-agent",
			includeBuiltinServers: false,
		});

		const view = await managed.source.refresh();
		const tool = view.tools[0]?.tool as EcosystemHookAwareRuntimeTool | undefined;

		expect(created).toHaveLength(1);
		expect(created[0]).toMatchObject({
			name: "search",
			config: { command: "search", debug: true },
			options: { debug: true },
		});
		expect(created[0]?.options?.httpAuthProviderFactory).toBeTypeOf("function");
		expect(tool).toMatchObject({
			name: "mcp_search_lookup",
			ecosystemHook: {
				hostName: "mcp_search_lookup",
				kind: "mcp",
				source: { ecosystem: "mcp", serverName: "search", originalName: "lookup" },
			},
		});
		await expect(
			tool?.execute({
				sessionId: "session",
				turnId: "turn",
				toolCallId: "call",
				input: { query: "value" },
				signal: new AbortController().signal,
			}),
		).resolves.toEqual({
			content: [{ type: "text", text: "native result" }],
			details: { content: [{ type: "text", text: "native result" }] },
		});

		await managed.dispose();
		expect(client.close).toHaveBeenCalledOnce();
	});
});

class StaticConfigSource implements McpConfigSource {
	constructor(private readonly servers: Record<string, McpServerConfig>) {}

	loadGlobal(): McpConfig | null {
		return null;
	}

	loadProject(): McpConfig | null {
		return { mcpServers: this.servers };
	}

	loadMerged(): McpConfig {
		return { mcpServers: this.servers };
	}

	getMergedSignature(): string {
		return "static";
	}

	getConfigPaths(): { readonly global: string; readonly project: string } {
		return { global: "global.json", project: "project.json" };
	}
}

class FakeClient implements McpClientHandle {
	readonly close = vi.fn(async () => {});

	async initialize() {
		return {
			protocolVersion: "test",
			serverInfo: { name: "search", version: "1" },
			capabilities: { tools: {} },
		};
	}

	async listTools() {
		return {
			tools: [
				{
					name: "lookup",
					description: "Lookup a value",
					inputSchema: { type: "object" as const, properties: { query: { type: "string" } } },
				},
			],
		};
	}

	async callTool() {
		return { content: [{ type: "text" as const, text: "native result" }] };
	}

	async listResources() {
		return { resources: [] };
	}

	async readResource() {
		return { contents: [] };
	}

	async listPrompts() {
		return { prompts: [] };
	}

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
