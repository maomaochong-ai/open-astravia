import type { McpCacheableResult } from "./cache.js";
import type { McpCapabilities } from "./types.js";

export interface McpDiscoverResult extends McpCacheableResult {
	readonly supportedVersions: string[];
	readonly capabilities: McpCapabilities;
	readonly instructions?: string;
}
