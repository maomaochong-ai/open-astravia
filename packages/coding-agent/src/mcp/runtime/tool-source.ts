import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import {
	createMcpServerRuntimeToolSource,
	type ManagedMcpRuntimeToolSource,
	type McpRuntimeToolDecorationContext,
	type McpToolResultPolicy,
} from "@vetta/runtime-mcp";
import type { EcosystemHookAwareRuntimeTool } from "../../extensions/runtime/ecosystem-hook-tool-wrapper.js";
import { createCodingAgentMcpToolResultPolicy } from "./result-policy.js";
import { type CodingAgentMcpSupervisorOptions, createCodingAgentMcpSupervisor } from "./supervisor.js";

export interface CodingAgentMcpRuntimeToolSourceOptions extends CodingAgentMcpSupervisorOptions {
	readonly resultPolicy?: McpToolResultPolicy;
}

/** Product MCP composition built directly on the Runtime Tool protocol. */
export async function createCodingAgentMcpRuntimeToolSource(
	options: CodingAgentMcpRuntimeToolSourceOptions = {},
): Promise<ManagedMcpRuntimeToolSource> {
	const debug = options.debug || false;
	const composition = createCodingAgentMcpSupervisor(options, (message) => {
		if (debug) console.error(`[MCPManager] ${message}`);
	});
	await composition.supervisor.initialize();
	return {
		source: createMcpServerRuntimeToolSource(composition.supervisor, {
			decorateTool: decorateCodingAgentMcpRuntimeTool,
			resultPolicy: options.resultPolicy ?? createCodingAgentMcpToolResultPolicy(options.agentDir),
		}),
		dispose: () => composition.supervisor.shutdown(),
	};
}

export function decorateCodingAgentMcpRuntimeTool(
	tool: RuntimeToolDefinition,
	context: McpRuntimeToolDecorationContext,
): EcosystemHookAwareRuntimeTool {
	return {
		...tool,
		ecosystemHook: {
			hostName: tool.name,
			kind: "mcp",
			source: {
				ecosystem: "mcp",
				serverName: context.serverName,
				originalName: context.toolName,
			},
		},
	};
}
