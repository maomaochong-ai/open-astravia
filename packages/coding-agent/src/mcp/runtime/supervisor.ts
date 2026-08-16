import type { McpConfigSource, RuntimeMcpClientFactory } from "@vetta/runtime-mcp";
import { createNodeMcpSupervisor, type NodeMcpSupervisorComposition } from "@vetta/runtime-node/mcp";
import { CONFIG_DIR_NAME, getAgentDir, VERSION } from "../../config.js";

export interface CodingAgentMcpSupervisorOptions {
	readonly projectRoot?: string;
	readonly agentDir?: string;
	readonly debug?: boolean;
	readonly enabled?: boolean;
	readonly configSource?: McpConfigSource;
	readonly clientFactory?: RuntimeMcpClientFactory;
	readonly includeBuiltinServers?: boolean;
}

export type CodingAgentMcpSupervisorComposition = NodeMcpSupervisorComposition;

/** 迁移期 Node 接线；平台根应直接选择 runtime-node MCP 实现。 */
export function createCodingAgentMcpSupervisor(
	options: CodingAgentMcpSupervisorOptions = {},
	onDiagnostic?: (message: string) => void,
): CodingAgentMcpSupervisorComposition {
	return createNodeMcpSupervisor({
		projectRoot: options.projectRoot ?? process.cwd(),
		agentDir: options.agentDir ?? getAgentDir(),
		clientVersion: VERSION,
		projectConfigDirectoryName: CONFIG_DIR_NAME,
		debug: options.debug,
		enabled: options.enabled,
		configSource: options.configSource,
		clientFactory: options.clientFactory,
		includeBuiltinServers: options.includeBuiltinServers,
		onDiagnostic,
	});
}
