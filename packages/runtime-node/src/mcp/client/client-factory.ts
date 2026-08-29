import type { RuntimeMcpClientFactory } from "@vetta/runtime-mcp/client";
import { isHttpServerConfig } from "../protocol/index.js";
import { HttpMcpClient } from "../transports/http/index.js";
import { StdioMcpClient } from "../transports/stdio/index.js";

/** Select the concrete client without introducing a shared low-level transport abstraction. */
export const createMcpClient: RuntimeMcpClientFactory = (name, config, options) => {
	if (isHttpServerConfig(config)) {
		return new HttpMcpClient({
			name,
			config,
			debug: options?.debug,
			timeout: options?.timeout,
			authProviderFactory: options?.httpAuthProviderFactory,
			onDiagnostic: options?.onDiagnostic,
		});
	}
	return new StdioMcpClient({
		name,
		config,
		debug: options?.debug,
		timeout: options?.timeout,
		onDiagnostic: options?.onDiagnostic,
	});
};
