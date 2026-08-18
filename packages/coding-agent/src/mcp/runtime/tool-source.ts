import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import {
	createMcpServerRuntimeToolSource,
	type ManagedMcpRuntimeToolSource,
	type McpRuntimeToolDecorationContext,
	type McpServerSupervisor,
	type McpToolResultPolicy,
	PRESERVE_MCP_TOOL_RESULT_POLICY,
} from "@vetta/runtime-mcp";
import type { EcosystemHookAwareRuntimeTool } from "../../extensions/runtime/ecosystem-hook-tool-wrapper.js";

export interface CodingAgentMcpRuntimeToolSourceOptions {
	/** Ownership transfers to the returned managed source, which shuts the supervisor down on dispose. */
	readonly supervisor: McpServerSupervisor;
	readonly resultPolicy?: McpToolResultPolicy;
}

/** Coding Agent MCP composition built directly on the Runtime Tool protocol. */
export async function createCodingAgentMcpRuntimeToolSource(
	options: CodingAgentMcpRuntimeToolSourceOptions,
): Promise<ManagedMcpRuntimeToolSource> {
	await options.supervisor.initialize();
	return {
		source: createMcpServerRuntimeToolSource(options.supervisor, {
			decorateTool: decorateCodingAgentMcpRuntimeTool,
			resultPolicy: options.resultPolicy ?? PRESERVE_MCP_TOOL_RESULT_POLICY,
		}),
		dispose: () => options.supervisor.shutdown(),
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
