import type { McpAppAttachment, McpAppResourceMeta, McpToolCallResult } from "@vetta/runtime-mcp";

export type DesktopMcpAppAttachment = McpAppAttachment;

export interface DesktopMcpAppSurface {
	readonly id: string;
	readonly resource: {
		readonly uri: string;
		readonly mimeType: "text/html;profile=mcp-app";
		readonly html: string;
		readonly meta?: McpAppResourceMeta;
	};
	readonly toolResult: McpToolCallResult;
	readonly capabilities: {
		readonly serverTools: boolean;
		readonly serverResources: true;
	};
}

export interface DesktopMcpAppToolCall {
	readonly surfaceId: string;
	readonly name: string;
	readonly arguments?: Record<string, unknown>;
}

export interface DesktopMcpAppResourceRead {
	readonly surfaceId: string;
	readonly uri: string;
}
