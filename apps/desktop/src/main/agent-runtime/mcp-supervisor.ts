import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { CONFIG_DIR_NAME, VERSION } from "@vetta/coding-agent/config";
import {
	EMPTY_MCP_CONFIG_SOURCE,
	MCP_APP_CLIENT_CAPABILITY,
	MCP_APPS_EXTENSION_ID,
	type McpServerInteractionHandlers,
	type McpServerSupervisor,
} from "@vetta/runtime-mcp";
import { createNodeMcpSupervisor } from "@vetta/runtime-node/mcp";
import { getDesktopMcpElicitationBroker } from "../conversations/mcp-elicitation-broker.js";
import { getAppLogger } from "../logger.js";

export interface DesktopMcpSupervisorOptions {
	readonly projectRoot: string;
	readonly agentDir: string;
	readonly debug: boolean;
	readonly dynamicOnly?: boolean;
	/** Sampling stays unavailable unless the product composition injects an approved model policy. */
	readonly samplingHandler?: McpServerInteractionHandlers["sampling"];
}

export function createDesktopMcpInteractionHandlers(
	options: Pick<DesktopMcpSupervisorOptions, "projectRoot" | "samplingHandler">,
	onDiagnostic: (message: string) => void = () => undefined,
): McpServerInteractionHandlers {
	const elicitationBroker = getDesktopMcpElicitationBroker();
	return {
		elicitation: async (params, context) => {
			const result = await elicitationBroker.handle(params, context);
			onDiagnostic(`interaction completed method=elicitation/create action=${result.action}`);
			return result;
		},
		roots: async () => ({
			roots: [{ uri: pathToFileURL(options.projectRoot).href, name: basename(options.projectRoot) || "workspace" }],
		}),
		...(options.samplingHandler ? { sampling: options.samplingHandler } : {}),
	};
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
	const interactionHandlers = createDesktopMcpInteractionHandlers(options, writeDiagnostic);
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
		interactionHandlers,
		clientCapabilities: {
			extensions: { [MCP_APPS_EXTENSION_ID]: MCP_APP_CLIENT_CAPABILITY },
		},
	}).supervisor;
}
