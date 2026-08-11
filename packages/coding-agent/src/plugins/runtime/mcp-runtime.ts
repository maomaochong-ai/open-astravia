import { createHash } from "node:crypto";
import type {
	ModelCallFrame,
	ModelCallFrameCompositionContext,
	RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import {
	createMcpDynamicServerRuntimeToolSource,
	createMcpRuntimeToolSynchronizer,
	type McpConfig,
	type McpConfigSource,
	type McpRuntimeToolSnapshot,
	type McpRuntimeToolView,
	type McpServerConfig,
	type McpServerSupervisor,
	type McpToolResultPolicy,
} from "@vetta/runtime-mcp";
import { createCodingAgentMcpToolResultPolicy } from "../../mcp/runtime/result-policy.js";
import { type CodingAgentMcpSupervisorOptions, createCodingAgentMcpSupervisor } from "../../mcp/runtime/supervisor.js";
import { decorateCodingAgentMcpRuntimeTool } from "../../mcp/runtime/tool-source.js";
import type { AgentPluginRuntimeConfig } from "../../model-context/index.js";
import { matchesAgentMode } from "../../profiles/index.js";
import type { CodingAgentPluginMcpRuntime as CodingAgentPluginMcpRuntimePort } from "../../runtime-contracts/index.js";

export interface CodingAgentPluginMcpRuntimeOptions
	extends Pick<CodingAgentMcpSupervisorOptions, "agentDir" | "clientFactory" | "debug"> {
	readonly resultPolicy?: McpToolResultPolicy;
}

export interface CodingAgentPluginMcpToolSurface {
	readonly frame: ModelCallFrame;
	readonly availableTools: ReadonlyMap<string, RuntimeToolDefinition>;
}

export interface CodingAgentPluginMcpCompositionOptions {
	readonly agentMode?: string;
	readonly isToolVisible: (toolName: string) => boolean;
}

/** Session-local plugin MCP runtime; file-backed MCP remains owned by the shared composition source. */
export class CodingAgentPluginMcpRuntime implements CodingAgentPluginMcpRuntimePort {
	private readonly tools = new Map<string, RuntimeToolDefinition>();
	private readonly synchronizer;
	private serverModes = new Map<string, readonly string[]>();
	private disposed = false;

	constructor(
		private readonly supervisor: McpServerSupervisor,
		private readonly source: ReturnType<typeof createMcpDynamicServerRuntimeToolSource>,
		private readonly debug: boolean,
	) {
		this.synchronizer = createMcpRuntimeToolSynchronizer(source, {
			register: (tool) => this.tools.set(tool.name, tool),
			unregister: (toolName) => this.tools.delete(toolName),
		});
	}

	async reconfigure(agentPlugins: AgentPluginRuntimeConfig | undefined): Promise<boolean> {
		const servers = new Map<string, McpServerConfig>();
		const nextModes = new Map<string, readonly string[]>();
		for (const contribution of agentPlugins?.mcpServerContributions ?? []) {
			if (!contribution.runtimeName || contribution.runtimeName.includes("_")) {
				this.log(`Rejecting plugin MCP server with invalid runtimeName: ${contribution.runtimeName}`);
				continue;
			}
			servers.set(contribution.runtimeName, contribution.config);
			nextModes.set(contribution.runtimeName, normalizeModes(contribution.agent_mode));
		}

		const signature = fingerprintPluginMcpServers(servers);
		const modesChanged = !sameServerModes(this.serverModes, nextModes);
		const serversChanged = await this.source.replaceDynamicServers({ servers, signature });
		this.serverModes = nextModes;
		await this.synchronizer.refresh();
		this.logServerOutcomes();
		return serversChanged || modesChanged;
	}

	refresh(): Promise<McpRuntimeToolSnapshot> {
		return this.synchronizer.refresh();
	}

	snapshot(): McpRuntimeToolSnapshot {
		return this.synchronizer.snapshot();
	}

	/** 供父 Session 向子 Session 投影现有绑定；连接和释放权仍属于本 Runtime。 */
	view(): McpRuntimeToolView {
		return this.synchronizer.view();
	}

	isManagedTool(toolName: string): boolean {
		return this.tools.has(toolName);
	}

	compose(
		context: ModelCallFrameCompositionContext,
		baseAvailableTools: ReadonlyMap<string, RuntimeToolDefinition>,
		options: CodingAgentPluginMcpCompositionOptions,
	): CodingAgentPluginMcpToolSurface {
		const availableTools = new Map(baseAvailableTools);
		const activeTools = new Map(context.frame.tools);
		for (const [name, tool] of this.tools) {
			availableTools.set(name, tool);
			if (options.isToolVisible(name) && this.matchesToolMode(name, options.agentMode)) {
				activeTools.set(name, tool);
			} else {
				activeTools.delete(name);
			}
		}
		return {
			frame: { instructions: context.frame.instructions, tools: activeTools },
			availableTools,
		};
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.synchronizer.dispose();
		await this.supervisor.shutdown();
	}

	private matchesToolMode(toolName: string, agentMode: string | undefined): boolean {
		for (const [serverName, modes] of this.serverModes) {
			if (toolName.startsWith(`mcp_${serverName}_`)) return matchesAgentMode(modes, agentMode);
		}
		return true;
	}

	private logServerOutcomes(): void {
		for (const server of this.supervisor.getState().servers) {
			if (server.status === "error" || server.status === "needs_auth") {
				console.error(`[MCP] Plugin server ${server.name} status=${server.status}: ${server.error ?? "unknown"}`);
			} else if (server.status === "ready") {
				this.log(`Plugin server ${server.name} ready with ${server.tools.length} tools`);
			}
		}
	}

	private log(message: string): void {
		if (this.debug) console.error(`[MCPManager] ${message}`);
	}
}

function fingerprintPluginMcpServers(servers: ReadonlyMap<string, McpServerConfig>): string {
	if (servers.size === 0) return "none";
	const payload = [...servers]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([runtimeName, config]) => ({ runtimeName, config }));
	return createHash("sha1").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

export async function createCodingAgentPluginMcpRuntime(
	options: CodingAgentPluginMcpRuntimeOptions = {},
): Promise<CodingAgentPluginMcpRuntime> {
	const composition = createCodingAgentMcpSupervisor(
		{
			...options,
			configSource: EMPTY_MCP_CONFIG_SOURCE,
			enabled: true,
			includeBuiltinServers: false,
		},
		(message) => {
			if (options.debug) console.error(`[MCPManager] ${message}`);
		},
	);
	await composition.supervisor.initialize();
	const source = createMcpDynamicServerRuntimeToolSource(composition.supervisor, {
		decorateTool: decorateCodingAgentMcpRuntimeTool,
		resultPolicy: options.resultPolicy ?? createCodingAgentMcpToolResultPolicy(options.agentDir),
	});
	return new CodingAgentPluginMcpRuntime(composition.supervisor, source, options.debug ?? false);
}

const EMPTY_MCP_CONFIG_SOURCE: McpConfigSource = {
	loadGlobal: () => null,
	loadProject: () => null,
	loadMerged: (): McpConfig => ({ mcpServers: {} }),
	getMergedSignature: () => "empty",
	getConfigPaths: () => ({ global: "<dynamic>", project: "<dynamic>" }),
};

function normalizeModes(modes: readonly string[] | undefined): readonly string[] {
	return [...new Set(modes ?? [])].sort();
}

function sameServerModes(
	current: ReadonlyMap<string, readonly string[]>,
	next: ReadonlyMap<string, readonly string[]>,
): boolean {
	if (current.size !== next.size) return false;
	for (const [serverName, modes] of current) {
		const nextModes = next.get(serverName);
		if (!nextModes || modes.length !== nextModes.length) return false;
		if (modes.some((mode, index) => mode !== nextModes[index])) return false;
	}
	return true;
}
