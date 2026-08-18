import type { McpConfig } from "../protocol/index.js";
import type { McpConfigSource } from "./config-source.js";

const EMPTY_MCP_CONFIG: McpConfig = Object.freeze({ mcpServers: Object.freeze({}) });

/** Config source for runtimes whose servers are supplied entirely through dynamic registration. */
export const EMPTY_MCP_CONFIG_SOURCE: McpConfigSource = Object.freeze({
	loadGlobal: () => null,
	loadProject: () => null,
	loadMerged: () => EMPTY_MCP_CONFIG,
	getMergedSignature: () => "empty",
	getConfigPaths: () => ({ global: "<dynamic>", project: "<dynamic>" }),
});
