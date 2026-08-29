import { CONFIG_DIR_NAME, VERSION } from "@vetta/coding-agent/config";
import { EMPTY_MCP_CONFIG_SOURCE, type McpServerSupervisor } from "@vetta/runtime-mcp";
import { createNodeMcpSupervisor } from "@vetta/runtime-node/mcp";
import { getAppLogger } from "../logger.js";

export interface DesktopMcpSupervisorOptions {
	readonly projectRoot: string;
	readonly agentDir: string;
	readonly debug: boolean;
	readonly dynamicOnly?: boolean;
}

/** Selects the Node MCP implementation at the Desktop Composition Root. */
export function createDesktopMcpSupervisor(options: DesktopMcpSupervisorOptions): McpServerSupervisor {
	let log: ReturnType<typeof getAppLogger> | undefined;
	const writeDiagnostic = (message: string): void => {
		try {
			log ??= getAppLogger("mcp");
		} catch {
			// Test hosts and lightweight sidecars may not configure Electron logging.
			return;
		}
		const isFailure = /failed|error|exit|timeout|invalid|unauthorized/i.test(message);
		if (isFailure) log.warn(message);
		else if (options.debug) log.debug(message);
	};
	return createNodeMcpSupervisor({
		projectRoot: options.projectRoot,
		agentDir: options.agentDir,
		clientVersion: VERSION,
		projectConfigDirectoryName: CONFIG_DIR_NAME,
		debug: options.debug,
		enabled: true,
		configSource: options.dynamicOnly ? EMPTY_MCP_CONFIG_SOURCE : undefined,
		includeBuiltinServers: !options.dynamicOnly,
		onDiagnostic: writeDiagnostic,
	}).supervisor;
}
