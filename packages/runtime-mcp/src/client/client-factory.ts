import { isHttpServerConfig, type McpServerConfig } from "../protocol/index.js";
import { HttpMcpClient, type McpHttpAuthProviderFactory } from "../transports/http/index.js";
import { StdioMcpClient } from "../transports/stdio/index.js";
import type { McpClientHandle } from "./client-handle.js";

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

/** Select the concrete client without introducing a shared low-level transport abstraction. */
export const createMcpClient: RuntimeMcpClientFactory = (name, config, options) => {
	if (isHttpServerConfig(config)) {
		return new HttpMcpClient({
			name,
			config,
			debug: options?.debug,
			timeout: options?.timeout,
			authProviderFactory: options?.httpAuthProviderFactory,
		});
	}
	return new StdioMcpClient({ name, config, debug: options?.debug, timeout: options?.timeout });
};
