import { join } from "node:path";
import { MCP_LATEST_PROTOCOL_VERSION, McpServerSupervisor, type RuntimeMcpClientFactory } from "@vetta/runtime-mcp";
import type { McpConfigSource } from "@vetta/runtime-mcp/config";
import {
	buildBuiltinMcpServers,
	FileMcpOAuthStateStore,
	loadVettaCredentials,
	McpOAuthProvider,
} from "./auth/index.js";
import { createMcpClient } from "./client/index.js";
import { FileMcpConfigSource } from "./config/index.js";

const MCP_PROTOCOL_VERSION = MCP_LATEST_PROTOCOL_VERSION;
const PLACEHOLDER_REDIRECT_URI = "http://127.0.0.1/callback";

export interface NodeMcpSupervisorOptions {
	readonly projectRoot: string;
	readonly agentDir: string;
	readonly clientVersion: string;
	readonly projectConfigDirectoryName?: string;
	readonly clientName?: string;
	readonly oauthClientName?: string;
	readonly debug?: boolean;
	readonly enabled?: boolean;
	readonly configSource?: McpConfigSource;
	readonly clientFactory?: RuntimeMcpClientFactory;
	readonly includeBuiltinServers?: boolean;
	readonly onDiagnostic?: (message: string) => void;
}

export interface NodeMcpSupervisorComposition {
	readonly supervisor: McpServerSupervisor;
	readonly configSource: McpConfigSource;
}

/** 组合 MCP 的 Node 文件、OAuth 与 transport 实现；工具语义仍由调用方装饰。 */
export function createNodeMcpSupervisor(options: NodeMcpSupervisorOptions): NodeMcpSupervisorComposition {
	const configSource =
		options.configSource ??
		new FileMcpConfigSource({
			globalConfigPath: join(options.agentDir, "mcp.json"),
			projectConfigPath: join(options.projectRoot, options.projectConfigDirectoryName ?? ".vetta", "mcp.json"),
			projectRoot: options.projectRoot,
		});
	const oauthStore = new FileMcpOAuthStateStore({ authDirectory: join(options.agentDir, "mcp-auth") });
	const clientFactory = options.clientFactory ?? createMcpClient;
	const supervisor = new McpServerSupervisor({
		builtinServers:
			options.includeBuiltinServers === false
				? {}
				: buildBuiltinMcpServers({
						clientVersion: options.clientVersion,
						loadCredentials: () => loadVettaCredentials(options.agentDir),
					}),
		configSource,
		clientFactory: (name, config, clientOptions) =>
			clientFactory(name, config, {
				...clientOptions,
				httpAuthProviderFactory: ({ serverName, serverUrl, config: httpConfig }) => {
					if (!oauthStore.hasTokens(serverName)) return undefined;
					return new McpOAuthProvider({
						serverName,
						serverUrl,
						redirectUri: oauthStore.load(serverName)?.redirectUri ?? PLACEHOLDER_REDIRECT_URI,
						onRedirect: () => undefined,
						store: oauthStore,
						clientName: options.oauthClientName ?? "Vetta",
						clientId: httpConfig.oauthClientId,
					});
				},
			}),
		protocolVersion: MCP_PROTOCOL_VERSION,
		clientInfo: { name: options.clientName ?? "vetta", version: options.clientVersion },
		enabled: options.enabled,
		debug: options.debug,
		onDiagnostic: options.onDiagnostic,
	});
	return { supervisor, configSource };
}
