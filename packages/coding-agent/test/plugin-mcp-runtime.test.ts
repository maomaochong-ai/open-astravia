import type { Api, Message, Model } from "@vetta/ai";
import type { ModelCallFrameCompositionContext, RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type {
	McpClientHandle,
	McpResourceReadResult,
	McpServerConfig,
	McpToolCallResult,
	RuntimeMcpClientFactory,
} from "@vetta/runtime-mcp";
import { describe, expect, it } from "vitest";
import type { EcosystemHookAwareRuntimeTool } from "../src/adapters/runtime-core/ecosystem-hook-tool-wrapper.js";
import type { AgentPluginRuntimeConfig } from "../src/model-context/index.js";
import { createCodingAgentPluginMcpRuntime } from "../src/plugins/runtime/mcp-runtime.js";

describe("CodingAgentPluginMcpRuntime", () => {
	it("isolates dynamic servers, preserves metadata and filters tools by session agent mode", async () => {
		const clients = new FakeClientFactory();
		const first = await createCodingAgentPluginMcpRuntime({ clientFactory: clients.create });
		const second = await createCodingAgentPluginMcpRuntime({ clientFactory: clients.create });

		await first.reconfigure(pluginConfig("alpha", "coding"));
		await second.reconfigure(pluginConfig("beta", "work"));

		expect(first.snapshot().tools.map(({ name }) => name)).toEqual(["mcp_plugin-alpha-docs_lookup"]);
		expect(second.snapshot().tools.map(({ name }) => name)).toEqual(["mcp_plugin-beta-docs_lookup"]);
		expect(first.isManagedTool("mcp_plugin-beta-docs_lookup")).toBe(false);
		expect(second.isManagedTool("mcp_plugin-alpha-docs_lookup")).toBe(false);

		const visible = first.compose(compositionContext(), new Map(), {
			agentMode: "coding",
			isToolVisible: () => true,
		});
		const hidden = first.compose(compositionContext(), new Map(), {
			agentMode: "work",
			isToolVisible: () => true,
		});
		const tool = visible.frame.tools.get("mcp_plugin-alpha-docs_lookup") as EcosystemHookAwareRuntimeTool | undefined;

		expect(tool?.ecosystemHook).toEqual({
			hostName: "mcp_plugin-alpha-docs_lookup",
			kind: "mcp",
			source: { ecosystem: "mcp", serverName: "plugin-alpha-docs", originalName: "lookup" },
		});
		expect(hidden.frame.tools.has("mcp_plugin-alpha-docs_lookup")).toBe(false);
		expect(hidden.availableTools.has("mcp_plugin-alpha-docs_lookup")).toBe(true);

		await first.dispose();
		expect(clients.first("plugin-alpha-docs").closeCalls).toBe(1);
		expect(clients.first("plugin-beta-docs").closeCalls).toBe(0);
		await second.dispose();
		expect(clients.first("plugin-beta-docs").closeCalls).toBe(1);
	});

	it("reconciles only real changes and lets a session plugin server override a base tool", async () => {
		const clients = new FakeClientFactory();
		const runtime = await createCodingAgentPluginMcpRuntime({ clientFactory: clients.create });
		const initial = pluginConfig("alpha", "coding", "alpha");

		expect(await runtime.reconfigure(initial)).toBe(true);
		expect(await runtime.reconfigure(initial)).toBe(false);
		expect(clients.named("plugin-alpha-docs")).toHaveLength(1);

		const modeOnly = pluginConfig("alpha", "work", "alpha");
		expect(await runtime.reconfigure(modeOnly)).toBe(true);
		expect(clients.named("plugin-alpha-docs")).toHaveLength(1);

		const changed = pluginConfig("alpha", "work", "alpha-v2");
		expect(await runtime.reconfigure(changed)).toBe(true);
		expect(clients.named("plugin-alpha-docs")).toHaveLength(2);
		expect(clients.first("plugin-alpha-docs").closeCalls).toBe(1);

		const name = "mcp_plugin-alpha-docs_lookup";
		const base = runtimeTool(name, "base");
		const context = compositionContext(new Map([[name, base]]));
		const surface = runtime.compose(context, context.frame.tools, {
			agentMode: "work",
			isToolVisible: () => true,
		});
		expect(surface.frame.tools.get(name)?.description).toBe("plugin-alpha-docs");

		expect(await runtime.reconfigure(undefined)).toBe(true);
		expect(clients.latest("plugin-alpha-docs").closeCalls).toBe(1);
		expect(runtime.snapshot().tools).toEqual([]);
		await runtime.dispose();
	});
});

function pluginConfig(name: string, agentMode: string, command = name): AgentPluginRuntimeConfig {
	return {
		mcpServerContributions: [
			{
				pluginId: `plugin-${name}`,
				localName: "docs",
				runtimeName: `plugin-${name}-docs`,
				config: { command },
				agent_mode: [agentMode],
			},
		],
	};
}

function compositionContext(
	tools: ReadonlyMap<string, RuntimeToolDefinition> = new Map(),
): ModelCallFrameCompositionContext {
	return {
		sessionId: "session",
		turnId: "turn",
		signal: new AbortController().signal,
		messages: [userMessage("inspect")],
		modelBinding: { model: MODEL },
		frame: { instructions: [], tools },
	};
}

function runtimeTool(name: string, description: string): RuntimeToolDefinition {
	return {
		name,
		label: name,
		description,
		inputSchema: { type: "object" },
		execute: async () => ({ content: [] }),
	};
}

class FakeClientFactory {
	readonly clients: FakeMcpClient[] = [];
	readonly create: RuntimeMcpClientFactory = (name, config) => {
		const client = new FakeMcpClient(name, config);
		this.clients.push(client);
		return client;
	};

	named(name: string): FakeMcpClient[] {
		return this.clients.filter((client) => client.name === name);
	}

	first(name: string): FakeMcpClient {
		const client = this.named(name)[0];
		if (!client) throw new Error(`Missing fake client: ${name}`);
		return client;
	}

	latest(name: string): FakeMcpClient {
		const clients = this.named(name);
		const client = clients[clients.length - 1];
		if (!client) throw new Error(`Missing fake client: ${name}`);
		return client;
	}
}

class FakeMcpClient implements McpClientHandle {
	closeCalls = 0;

	constructor(
		readonly name: string,
		private readonly config: McpServerConfig,
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
			tools: [
				{
					name: "lookup",
					description: this.name,
					inputSchema: { type: "object" as const },
				},
			],
		};
	}

	async callTool(): Promise<McpToolCallResult> {
		return {
			content: [
				{
					type: "text",
					text: this.config.type === "http" ? this.config.url : this.config.command,
				},
			],
		};
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

function userMessage(text: string): Extract<Message, { role: "user" }> {
	return { role: "user", content: text, timestamp: 1 };
}

const MODEL: Model<Api> = {
	id: "model",
	name: "Model",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8_000,
	maxTokens: 1_000,
};
