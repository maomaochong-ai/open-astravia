import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	McpClientHandle,
	McpConfig,
	McpConfigSource,
	McpServerConfig,
	McpToolResultOffloadDetails,
	RuntimeMcpClientFactory,
	RuntimeMcpClientFactoryOptions,
} from "@vetta/runtime-mcp";
import { DEFAULT_MCP_MAX_INLINE_RESULT_BYTES } from "@vetta/runtime-mcp";
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

	it("uses the product file policy for large results", async () => {
		const agentDir = await mkdtemp(join(tmpdir(), "vetta-native-mcp-"));
		const source = new StaticConfigSource({ search: { command: "search" } });
		const originalText = `start-${"x".repeat(DEFAULT_MCP_MAX_INLINE_RESULT_BYTES)}-end`;
		const client = new FakeClient(originalText);
		const managed = await createCodingAgentMcpRuntimeToolSource({
			configSource: source,
			clientFactory: () => client,
			agentDir,
			includeBuiltinServers: false,
		});
		try {
			const tool = (await managed.source.refresh()).tools[0]?.tool;
			const result = await tool?.execute({
				sessionId: "session",
				turnId: "turn",
				toolCallId: "call",
				input: {},
				signal: new AbortController().signal,
			});
			const details = result?.details as McpToolResultOffloadDetails;

			expect(details).toMatchObject({ offloaded: true, textTruncated: true });
			expect(details.artifact.reference.startsWith(join(agentDir, "mcp-results"))).toBe(true);
			expect(JSON.parse(await readFile(details.artifact.reference, "utf8"))).toEqual({
				content: [{ type: "text", text: originalText }],
			});
		} finally {
			await managed.dispose();
			await rm(agentDir, { recursive: true, force: true });
		}
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

	constructor(private readonly resultText = "native result") {}

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
		return { content: [{ type: "text" as const, text: this.resultText }] };
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
