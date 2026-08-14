import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { McpHttpServerConfig, McpServerConfig } from "../protocol/index.js";
import type { McpClientHandle } from "./client-handle.js";

export interface McpHttpAuthProviderContext {
	readonly serverName: string;
	readonly serverUrl: string;
	readonly config: McpHttpServerConfig;
}

export type McpHttpAuthProviderFactory = (context: McpHttpAuthProviderContext) => OAuthClientProvider | undefined;

export interface RuntimeMcpClientFactoryOptions {
	readonly debug?: boolean;
	readonly timeout?: number;
	readonly httpAuthProviderFactory?: McpHttpAuthProviderFactory;
}

export type RuntimeMcpClientFactory = (
	name: string,
	config: McpServerConfig,
	options?: RuntimeMcpClientFactoryOptions,
) => McpClientHandle;
