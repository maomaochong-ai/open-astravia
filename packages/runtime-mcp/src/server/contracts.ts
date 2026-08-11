import type { McpClientHandle } from "../client/index.js";
import type {
	McpConfig,
	McpResource,
	McpServerConfig,
	McpServerInfo,
	McpServerStatus,
	McpTool,
} from "../protocol/index.js";

/** Transport-neutral observation of one managed MCP server. */
export interface McpServerView {
	readonly name: string;
	readonly config: McpServerConfig;
	readonly status: McpServerStatus;
	readonly serverInfo?: McpServerInfo;
	readonly tools: readonly McpTool[];
	readonly resources: readonly McpResource[];
	readonly error?: string;
	readonly pid?: number;
	readonly startedAt?: number;
}

/** Internal-runtime binding exposed to host adapters that need to invoke tools. */
export interface McpServerBinding {
	readonly view: McpServerView;
	readonly client?: McpClientHandle;
}

export interface McpServerSupervisorState {
	readonly enabled: boolean;
	readonly servers: readonly McpServerView[];
	readonly globalConfig?: McpConfig;
	readonly projectConfig?: McpConfig;
}

export interface McpServerSupervisorStats {
	readonly totalServers: number;
	readonly readyServers: number;
	readonly errorServers: number;
	readonly totalTools: number;
	readonly totalResources: number;
}

/** Complete replacement set supplied by a dynamic capability source such as plugins. */
export interface McpDynamicServerSet {
	readonly servers: ReadonlyMap<string, McpServerConfig>;
	readonly signature: string;
}

export interface McpServerDisconnectOutcome {
	readonly status: "stopped" | "needs_auth";
	readonly error?: string;
}
