import { CONFIG_DIR_NAME, VERSION } from "@vetta/coding-agent/config";
import { EMPTY_MCP_CONFIG_SOURCE, type McpServerSupervisor } from "@vetta/runtime-mcp";
import { createNodeMcpSupervisor } from "@vetta/runtime-node/mcp";

export interface DesktopMcpSupervisorOptions {
	readonly projectRoot: string;
	readonly agentDir: string;
	readonly debug: boolean;
	readonly dynamicOnly?: boolean;
}

/** Selects the Node MCP implementation at the Desktop Composition Root. */
export function createDesktopMcpSupervisor(options: DesktopMcpSupervisorOptions): McpServerSupervisor {
	return createNodeMcpSupervisor({
		projectRoot: options.projectRoot,
		agentDir: options.agentDir,
		clientVersion: VERSION,
		projectConfigDirectoryName: CONFIG_DIR_NAME,
		debug: options.debug,
		enabled: true,
		configSource: options.dynamicOnly ? EMPTY_MCP_CONFIG_SOURCE : undefined,
		includeBuiltinServers: !options.dynamicOnly,
		onDiagnostic: (message) => {
			if (options.debug) console.error(`[MCPManager] ${message}`);
		},
	}).supervisor;
}
