import { createHash } from "node:crypto";
import type {
	ModelCallFrame,
	ModelCallFrameCompositionContext,
	RuntimeSnapshotAcquireContext,
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
import type {
	CodingAgentPluginMcpRuntime as CodingAgentPluginMcpRuntimePort,
	CodingAgentPluginMcpToolComposer,
} from "../../runtime-contracts/index.js";

export interface CodingAgentPluginMcpRuntimeOptions
	extends Pick<CodingAgentMcpSupervisorOptions, "agentDir" | "clientFactory" | "debug"> {
	readonly resultPolicy?: McpToolResultPolicy;
}

export interface CodingAgentPluginMcpToolSurface {
	readonly frame: ModelCallFrame;
	readonly availableTools: ReadonlyMap<string, RuntimeToolDefinition>;
}

export interface CodingAgentPluginMcpCompositionOptions {
	readonly isToolVisible: (toolName: string) => boolean;
}

/** Session-local plugin MCP runtime; file-backed MCP remains owned by the shared composition source. */
export class CodingAgentPluginMcpRuntime implements CodingAgentPluginMcpRuntimePort {
	private readonly tools = new Map<string, RuntimeToolDefinition>();
	private readonly synchronizer;
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
		for (const contribution of agentPlugins?.mcpServerContributions ?? []) {
			if (!contribution.runtimeName || contribution.runtimeName.includes("_")) {
				this.log(`Rejecting plugin MCP server with invalid runtimeName: ${contribution.runtimeName}`);
				continue;
			}
			servers.set(contribution.runtimeName, contribution.config);
		}

		const signature = fingerprintPluginMcpServers(servers);
		const serversChanged = await this.source.replaceDynamicServers({ servers, signature });
		await this.synchronizer.refresh();
		this.logServerOutcomes();
		return serversChanged;
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

	bindForTurn(context: RuntimeSnapshotAcquireContext): CodingAgentPluginMcpToolComposer {
		context.signal.throwIfAborted();
		const leases: Array<{ release(): Promise<void> | void }> = [];
		const tools = new Map<string, RuntimeToolDefinition>();
		try {
			for (const [name, tool] of this.tools) {
				const lease = tool.bindForTurn?.(context);
				if (lease) leases.push(lease);
				tools.set(name, lease?.tool ?? tool);
			}
		} catch (error) {
			for (const lease of leases.reverse()) void lease.release();
			throw error;
		}
		let released = false;
		return {
			bindForTurn: () => this.bindForTurn(context),
			async releaseTurnBinding() {
				if (released) return;
				released = true;
				const results = await Promise.allSettled(leases.map((lease) => lease.release()));
				const errors = results
					.filter((result): result is PromiseRejectedResult => result.status === "rejected")
					.map(({ reason }) => reason);
				if (errors.length > 0) throw new AggregateError(errors, "Failed to release plugin MCP Turn binding");
			},
			compose: (compositionContext, baseAvailableTools, options) =>
				composePluginMcpSurface(tools, compositionContext, baseAvailableTools, options),
		};
	}

	compose(
		context: ModelCallFrameCompositionContext,
		baseAvailableTools: ReadonlyMap<string, RuntimeToolDefinition>,
		options: CodingAgentPluginMcpCompositionOptions,
	): CodingAgentPluginMcpToolSurface {
		return composePluginMcpSurface(this.tools, context, baseAvailableTools, options);
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.synchronizer.dispose();
		await this.supervisor.shutdown();
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

function composePluginMcpSurface(
	tools: ReadonlyMap<string, RuntimeToolDefinition>,
	context: ModelCallFrameCompositionContext,
	baseAvailableTools: ReadonlyMap<string, RuntimeToolDefinition>,
	options: CodingAgentPluginMcpCompositionOptions,
): CodingAgentPluginMcpToolSurface {
	const availableTools = new Map(baseAvailableTools);
	const activeTools = new Map(context.frame.tools);
	// 可见性开关是硬闸；工作模式不参与组装（ADR-0071），顺序即注册序。
	for (const [name, tool] of tools) {
		availableTools.set(name, tool);
		if (options.isToolVisible(name)) activeTools.set(name, tool);
		else activeTools.delete(name);
	}
	return { frame: { instructions: context.frame.instructions, tools: activeTools }, availableTools };
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
