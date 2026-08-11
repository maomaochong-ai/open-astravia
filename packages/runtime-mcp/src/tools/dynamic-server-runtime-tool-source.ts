import type { McpRuntimeToolSource, McpRuntimeToolView } from "../runtime-tool-synchronizer.js";
import type { McpDynamicServerSet } from "../server/index.js";
import {
	type McpServerRuntimePort,
	McpServerRuntimeToolSource,
	type McpServerRuntimeToolSourceOptions,
} from "./server-runtime-tool-source.js";

export interface McpDynamicServerRuntimePort extends McpServerRuntimePort {
	setDynamicServers(next: McpDynamicServerSet): Promise<boolean>;
}

/** Runtime Tool Source with a complete-replacement dynamic Server control boundary. */
export interface McpDynamicRuntimeToolSource extends McpRuntimeToolSource {
	replaceDynamicServers(next: McpDynamicServerSet): Promise<boolean>;
}

/** Keeps the Supervisor private while exposing only dynamic replacement and Tool refresh. */
export class McpDynamicServerRuntimeToolSource implements McpDynamicRuntimeToolSource {
	private readonly tools: McpServerRuntimeToolSource;

	constructor(
		private readonly servers: McpDynamicServerRuntimePort,
		options?: McpServerRuntimeToolSourceOptions,
	) {
		this.tools = new McpServerRuntimeToolSource(servers, options);
	}

	replaceDynamicServers(next: McpDynamicServerSet): Promise<boolean> {
		return this.servers.setDynamicServers(next);
	}

	refresh(): Promise<McpRuntimeToolView> {
		return this.tools.refresh();
	}
}

export function createMcpDynamicServerRuntimeToolSource(
	servers: McpDynamicServerRuntimePort,
	options?: McpServerRuntimeToolSourceOptions,
): McpDynamicRuntimeToolSource {
	return new McpDynamicServerRuntimeToolSource(servers, options);
}
