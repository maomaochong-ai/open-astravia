import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Api, type AssistantMessage, type AssistantMessageEvent, EventStream, type Model } from "@vetta/ai";
import { createGreenfieldRuntimeComposition, type GreenfieldRuntimeComposition } from "@vetta/coding-agent/composition";
import { createCodingAgentPluginMcpRuntime } from "@vetta/coding-agent/host-services";
import type { AgentPluginRuntimeConfig } from "@vetta/runtime-core";
import type {
	McpClientHandle,
	McpResourceReadResult,
	McpToolCallResult,
	RuntimeMcpClientFactory,
} from "@vetta/runtime-mcp";
import { afterEach, describe, expect, it, vi } from "vitest";

const INTEGRATION_TEST_TIMEOUT_MS = 30_000;

describe("Greenfield session-local plugin MCP", { timeout: INTEGRATION_TEST_TIMEOUT_MS }, () => {
	const directories: string[] = [];
	const compositions: GreenfieldRuntimeComposition[] = [];

	afterEach(async () => {
		for (const composition of compositions.splice(0).reverse()) await composition.dispose();
		for (const directory of directories.splice(0).reverse()) {
			await rm(directory, { recursive: true, force: true });
		}
	}, INTEGRATION_TEST_TIMEOUT_MS);

	it("isolates two sessions and applies complete plugin replacement at the next model call", async () => {
		const conversationDir = await temporaryDirectory("greenfield-plugin-mcp-");
		const clients = new FakeClientFactory();
		const modelMcpTools: string[][] = [];
		const composition = await createGreenfieldRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			enableSubagents: false,
			createPluginMcpRuntime: () => createCodingAgentPluginMcpRuntime({ clientFactory: clients.create }),
			streamFn: (_model, context) => {
				modelMcpTools.push(
					(context.tools ?? []).map(({ name }) => name).filter((name) => name.startsWith("mcp_plugin-")),
				);
				return new RecordedAssistantStream(assistantText("done"));
			},
		});
		compositions.push(composition);
		const first = await composition.backend.create({
			sessionId: "first",
			agentMode: "coding",
			agentPlugins: pluginConfiguration("alpha", "coding"),
		});
		const second = await composition.backend.create({
			sessionId: "second",
			agentMode: "work",
			agentPlugins: pluginConfiguration("beta", "work"),
		});

		await first.prompt({ text: "first" });
		await second.prompt({ text: "second" });
		expect(modelMcpTools).toEqual([["mcp_plugin-alpha-docs_lookup"], ["mcp_plugin-beta-docs_lookup"]]);

		await first
			.createRuntimeHostAssemblyCandidate()
			.configurationController?.reconfigureAgentPlugins(pluginConfiguration("gamma", "coding"));
		await first.prompt({ text: "first replaced" });
		await second.prompt({ text: "second unchanged" });

		expect(modelMcpTools.slice(2)).toEqual([["mcp_plugin-gamma-docs_lookup"], ["mcp_plugin-beta-docs_lookup"]]);
		expect(clients.first("plugin-alpha-docs").closeCalls).toBe(1);
		expect(clients.first("plugin-beta-docs").closeCalls).toBe(0);

		await first.dispose();
		expect(clients.first("plugin-gamma-docs").closeCalls).toBe(1);
		expect(clients.first("plugin-beta-docs").closeCalls).toBe(0);
		await second.dispose();
		expect(clients.first("plugin-beta-docs").closeCalls).toBe(1);
	});

	it("includes session plugin tools in progressive disclosure and removes the search surface", async () => {
		const conversationDir = await temporaryDirectory("greenfield-plugin-mcp-deferred-");
		const clients = new FakeClientFactory(16);
		const modelMcpTools: string[][] = [];
		const composition = await createGreenfieldRuntimeComposition({
			conversationDir,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			enableSubagents: false,
			createPluginMcpRuntime: () => createCodingAgentPluginMcpRuntime({ clientFactory: clients.create }),
			streamFn: (_model, context) => {
				modelMcpTools.push(
					(context.tools ?? [])
						.map(({ name }) => name)
						.filter((name) => name === "tool_search" || name.startsWith("mcp_plugin-")),
				);
				return new RecordedAssistantStream(assistantText("done"));
			},
		});
		compositions.push(composition);
		const session = await composition.backend.create({
			sessionId: "deferred",
			agentPlugins: pluginConfiguration("many", "coding"),
		});

		await session.prompt({ text: "discover" });
		expect(modelMcpTools[0]).toEqual(["tool_search"]);

		await session.createRuntimeHostAssemblyCandidate().configurationController?.reconfigureAgentPlugins(undefined);
		await session.prompt({ text: "removed" });
		expect(modelMcpTools[1]).toEqual([]);
		await session.dispose();
	});

	it("projects parent plugin MCP bindings into workflow children without creating another plugin runtime", async () => {
		const conversationDir = await temporaryDirectory("greenfield-plugin-mcp-subagent-");
		const clients = new FakeClientFactory();
		const createPluginMcpRuntime = vi.fn(() => createCodingAgentPluginMcpRuntime({ clientFactory: clients.create }));
		const rootMcpTools: string[][] = [];
		const childMcpTools: string[][] = [];
		let rootCalls = 0;
		const composition = await createGreenfieldRuntimeComposition({
			conversationDir,
			enableSubagents: true,
			modelRegistry: modelRegistry(),
			initialModel: MODEL,
			initialThinkingLevel: "off",
			createPluginMcpRuntime,
			streamFn: (_model, context) => {
				const toolNames = (context.tools ?? []).map(({ name }) => name);
				const mcpTools = toolNames.filter((name) => name.startsWith("mcp_plugin-"));
				if (toolNames.includes("spawn_agent")) {
					rootMcpTools.push(mcpTools);
					if (rootCalls === 0) {
						rootCalls += 1;
						return new RecordedAssistantStream(
							assistantToolCall("dispatch_workflows", {
								description: "Inspect inherited MCP tools",
								workflows: [
									{
										task_name: "inspect_mcp",
										title: "Inspect MCP",
										message: "Report the available MCP tools.",
										todos: ["Inspect inherited MCP tools"],
									},
								],
							}),
						);
					}
					return new RecordedAssistantStream(assistantText("root done"));
				}
				childMcpTools.push(mcpTools);
				if (childMcpTools.length === 1) {
					return new RecordedAssistantStream(assistantToolCall("mcp_plugin-child-docs_lookup", {}));
				}
				return new RecordedAssistantStream(assistantText("child done"));
			},
		});
		compositions.push(composition);
		const session = await composition.backend.create({
			sessionId: "plugin-mcp-subagent",
			agentMode: "work",
			agentPlugins: pluginConfiguration("child", "coding"),
		});

		await session.prompt({ text: "delegate MCP inspection" });
		await vi.waitFor(() => {
			expect(childMcpTools.length).toBeGreaterThanOrEqual(2);
			expect(clients.first("plugin-child-docs").callToolCalls).toBe(1);
		});

		expect(rootMcpTools[0]).toEqual([]);
		expect(childMcpTools[0]).toEqual(["mcp_plugin-child-docs_lookup"]);
		expect(clients.first("plugin-child-docs").callToolCalls).toBe(1);
		expect(createPluginMcpRuntime).toHaveBeenCalledOnce();
		expect(clients.clients).toHaveLength(1);
		await session.dispose();
		expect(clients.first("plugin-child-docs").closeCalls).toBe(1);
	});

	async function temporaryDirectory(prefix: string): Promise<string> {
		const directory = await mkdtemp(join(tmpdir(), prefix));
		directories.push(directory);
		return directory;
	}
});

function pluginConfiguration(name: string, agentMode: string): AgentPluginRuntimeConfig {
	return {
		mcpServerContributions: [
			{
				pluginId: `plugin-${name}`,
				localName: "docs",
				runtimeName: `plugin-${name}-docs`,
				config: { command: name },
				agent_mode: [agentMode],
			},
		],
	};
}

class FakeClientFactory {
	readonly clients: FakeMcpClient[] = [];

	constructor(private readonly toolCount = 1) {}

	readonly create: RuntimeMcpClientFactory = (name) => {
		const client = new FakeMcpClient(name, this.toolCount);
		this.clients.push(client);
		return client;
	};

	first(name: string): FakeMcpClient {
		const client = this.clients.find((candidate) => candidate.name === name);
		if (!client) throw new Error(`Missing fake client: ${name}`);
		return client;
	}
}

class FakeMcpClient implements McpClientHandle {
	closeCalls = 0;
	callToolCalls = 0;

	constructor(
		readonly name: string,
		private readonly toolCount: number,
	) {}

	async initialize() {
		return {
			protocolVersion: "test",
			serverInfo: { name: this.name, version: "1" },
			capabilities: { tools: {} },
		};
	}

	async listTools() {
		return {
			tools: Array.from({ length: this.toolCount }, (_, index) => ({
				name: this.toolCount === 1 ? "lookup" : `lookup_${index}`,
				description: `${this.name}:${index}`,
				inputSchema: { type: "object" as const },
			})),
		};
	}

	async callTool(): Promise<McpToolCallResult> {
		this.callToolCalls += 1;
		return { content: [{ type: "text", text: this.name }] };
	}

	async listResources() {
		return { resources: [] };
	}

	async readResource(): Promise<McpResourceReadResult> {
		return { contents: [] };
	}

	async listPrompts() {
		return { prompts: [] };
	}

	async close(): Promise<void> {
		this.closeCalls += 1;
	}

	getName(): string {
		return this.name;
	}

	getPid(): number | undefined {
		return undefined;
	}

	isClientInitialized(): boolean {
		return true;
	}
}

class RecordedAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor(message: AssistantMessage) {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected assistant event");
			},
		);
		queueMicrotask(() => {
			if (message.stopReason === "error" || message.stopReason === "aborted") {
				this.push({ type: "error", reason: message.stopReason, error: message });
				return;
			}
			this.push({ type: "done", reason: message.stopReason, message });
		});
	}
}

function assistantText(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: MODEL.api,
		provider: MODEL.provider,
		model: MODEL.id,
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
}

function assistantToolCall(name: string, arguments_: Readonly<Record<string, unknown>>): AssistantMessage {
	return {
		...assistantText(""),
		content: [{ type: "toolCall", id: `${name}-call`, name, arguments: arguments_ }],
		stopReason: "toolUse",
	};
}

function modelRegistry() {
	return {
		refresh() {},
		getAvailable: () => [MODEL],
		find: (provider: string, modelId: string) =>
			provider === MODEL.provider && modelId === MODEL.id ? MODEL : undefined,
		getApiKey: async () => "test-key",
		setServerToken() {},
		loadRemoteModels: async () => undefined,
	};
}

const MODEL: Model<Api> = {
	id: "recorded-model",
	name: "Recorded Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
