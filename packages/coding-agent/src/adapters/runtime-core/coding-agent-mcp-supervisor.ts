import { join } from "node:path";
import {
	buildBuiltinMcpServers,
	createMcpClient,
	FileMcpConfigSource,
	FileMcpOAuthStateStore,
	loadVettaCredentials,
	type McpConfigSource,
	McpOAuthProvider,
	McpServerSupervisor,
	type RuntimeMcpClientFactory,
} from "@vetta/runtime-mcp";
import { CONFIG_DIR_NAME, getAgentDir, VERSION } from "../../config.js";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const CLIENT_NAME = "vetta";
const PLACEHOLDER_REDIRECT_URI = "http://127.0.0.1/callback";

export interface CodingAgentMcpSupervisorOptions {
	readonly projectRoot?: string;
	readonly agentDir?: string;
	readonly debug?: boolean;
	readonly enabled?: boolean;
	readonly configSource?: McpConfigSource;
	readonly clientFactory?: RuntimeMcpClientFactory;
	readonly includeBuiltinServers?: boolean;
}

export interface CodingAgentMcpSupervisorComposition {
	readonly supervisor: McpServerSupervisor;
	readonly configSource: McpConfigSource;
}

/** Inject Coding Agent paths and persisted OAuth credentials into the generic MCP runtime. */
export function createCodingAgentMcpSupervisor(
	options: CodingAgentMcpSupervisorOptions = {},
	onDiagnostic?: (message: string) => void,
): CodingAgentMcpSupervisorComposition {
	const projectRoot = options.projectRoot ?? process.cwd();
	const agentDir = options.agentDir ?? getAgentDir();
	const configSource =
		options.configSource ??
		new FileMcpConfigSource({
			globalConfigPath: join(agentDir, "mcp.json"),
			projectConfigPath: join(projectRoot, CONFIG_DIR_NAME, "mcp.json"),
			projectRoot,
		});
	const oauthStore = new FileMcpOAuthStateStore({ authDirectory: join(agentDir, "mcp-auth") });
	const clientFactory = options.clientFactory ?? createMcpClient;
	const loadBuiltinCredentials = () => loadVettaCredentials(agentDir);
	const supervisor = new McpServerSupervisor({
		builtinServers:
			options.includeBuiltinServers === false
				? {}
				: buildBuiltinMcpServers({ clientVersion: VERSION, loadCredentials: loadBuiltinCredentials }),
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
						clientName: "Vetta",
						clientId: httpConfig.oauthClientId,
					});
				},
			}),
		protocolVersion: MCP_PROTOCOL_VERSION,
		clientInfo: { name: CLIENT_NAME, version: VERSION },
		enabled: options.enabled,
		debug: options.debug,
		onDiagnostic,
	});
	return { supervisor, configSource };
}
