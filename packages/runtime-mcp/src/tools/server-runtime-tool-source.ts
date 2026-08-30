import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { McpAppExecutionHost } from "../apps/index.js";
import { isMcpAppToolVisibleToModel } from "../protocol/index.js";
import type { McpRuntimeToolBinding, McpRuntimeToolSource, McpRuntimeToolView } from "../runtime-tool-synchronizer.js";
import type { McpServerBinding } from "../server/index.js";
import type { McpTaskExecutionCoordinator } from "../tasks/index.js";
import { createMcpRuntimeTool } from "./mcp-runtime-tool.js";
import { type McpToolResultPolicy, PRESERVE_MCP_TOOL_RESULT_POLICY } from "./mcp-tool-result-policy.js";

export interface McpServerRuntimePort {
	reloadIfChanged(): Promise<boolean>;
	getReadyServerBindings(): readonly McpServerBinding[];
}

export interface McpRuntimeToolDecorationContext {
	readonly serverName: string;
	readonly toolName: string;
}

export type McpRuntimeToolDecorator = (
	tool: RuntimeToolDefinition,
	context: McpRuntimeToolDecorationContext,
) => RuntimeToolDefinition;

export interface McpServerRuntimeToolSourceOptions {
	readonly decorateTool?: McpRuntimeToolDecorator;
	readonly resultPolicy?: McpToolResultPolicy;
	readonly taskCoordinator?: McpTaskExecutionCoordinator;
	readonly appHost?: McpAppExecutionHost;
}

/** Publishes ready Supervisor bindings directly as Runtime tools, without an AgentTool round-trip. */
export class McpServerRuntimeToolSource implements McpRuntimeToolSource {
	constructor(
		private readonly servers: McpServerRuntimePort,
		private readonly options: McpServerRuntimeToolSourceOptions = {},
	) {}

	async refresh(): Promise<McpRuntimeToolView> {
		await this.servers.reloadIfChanged();
		const bindings = this.servers.getReadyServerBindings();
		await this.options.taskCoordinator?.recover(bindings);
		const resultPolicy = this.options.resultPolicy ?? PRESERVE_MCP_TOOL_RESULT_POLICY;
		const tools: McpRuntimeToolBinding[] = [];
		for (const binding of bindings) {
			const client = binding.client;
			if (!client) continue;
			for (const mcpTool of binding.view.tools) {
				if (!isMcpAppToolVisibleToModel(mcpTool)) continue;
				const createTool = (boundClient: typeof client): RuntimeToolDefinition => {
					const baseTool = createMcpRuntimeTool(mcpTool, boundClient, binding.view.name, {
						resultPolicy,
						taskCoordinator: this.options.taskCoordinator,
						appHost: this.options.appHost,
						acquireAppClient: () => binding.acquireLease(),
						serverTools: binding.view.tools,
						autoApproveTools: binding.view.config.autoApprove ?? [],
					});
					return this.options.decorateTool
						? this.options.decorateTool(baseTool, {
								serverName: binding.view.name,
								toolName: mcpTool.name,
							})
						: baseTool;
				};
				const decorated = createTool(client);
				const tool: RuntimeToolDefinition = {
					...decorated,
					bindForTurn: () => {
						const lease = binding.acquireLease();
						if (!lease.client) {
							void lease.release();
							throw new Error(`MCP server connection is unavailable: ${binding.view.name}`);
						}
						return { tool: createTool(lease.client), release: () => lease.release() };
					},
				};
				tools.push(
					Object.freeze({
						tool,
						fingerprint: JSON.stringify({
							server: binding.view.name,
							status: binding.view.status,
							startedAt: binding.view.startedAt,
							tool: mcpTool,
						}),
					}),
				);
			}
		}
		return Object.freeze({ tools: Object.freeze(tools) });
	}
}

export function createMcpServerRuntimeToolSource(
	servers: McpServerRuntimePort,
	options?: McpServerRuntimeToolSourceOptions,
): McpRuntimeToolSource {
	return new McpServerRuntimeToolSource(servers, options);
}
