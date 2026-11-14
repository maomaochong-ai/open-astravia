import type {
	McpHttpServerConfigData,
	McpServerConfigData,
	McpSseServerConfigData,
	McpStdioServerConfigData,
} from "../preload/api-types/mcp.js";

/** stdio 是缺省类型：`type` 省略与 `"stdio"` 等价。 */
export function isStdioMcpServer(server: McpServerConfigData): server is McpStdioServerConfigData {
	return server.type === undefined || server.type === "stdio";
}

/** 以 URL 连接的远程 server：Streamable HTTP 或旧式 SSE。 */
export function isRemoteMcpServer(
	server: McpServerConfigData,
): server is McpHttpServerConfigData | McpSseServerConfigData {
	return server.type === "http" || server.type === "sse";
}
