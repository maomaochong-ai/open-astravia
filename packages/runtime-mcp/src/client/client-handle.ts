import type { IMcpClient } from "../protocol/index.js";

/** Common lifecycle surface implemented by stdio and HTTP MCP clients. */
export interface McpClientHandle extends IMcpClient {
	getName(): string;
	getPid(): number | undefined;
	isClientInitialized(): boolean;
}
