/** Transport-neutral MCP protocol and configuration contracts. */

export type McpJsonObject = Record<string, unknown>;

export interface McpServerCommonConfig {
	disabled?: boolean;
	autoApprove?: string[];
	startupTimeout?: number;
	debug?: boolean;
	displayName?: string;
	description?: string;
}

export interface McpStdioServerConfig extends McpServerCommonConfig {
	type?: "stdio";
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
}

export interface McpHttpServerConfig extends McpServerCommonConfig {
	type: "http";
	url: string;
	headers?: Record<string, string>;
	/** Runtime-only header source for rotating credentials; never persisted to mcp.json. */
	resolveHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
	oauthClientId?: string;
	oauthDeviceFlow?: boolean;
	oauthScopes?: string;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export function isHttpServerConfig(config: McpServerConfig): config is McpHttpServerConfig {
	return config.type === "http";
}

export function isStdioServerConfig(config: McpServerConfig): config is McpStdioServerConfig {
	return config.type === undefined || config.type === "stdio";
}

export interface McpConfig {
	mcpServers: Record<string, McpServerConfig>;
}

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: string | number;
	method: string;
	params?: unknown;
}

export interface JsonRpcSuccessResponse {
	jsonrpc: "2.0";
	id: string | number;
	result: unknown;
}

export interface JsonRpcErrorResponse {
	jsonrpc: "2.0";
	id: string | number;
	error: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

export interface McpCapabilities {
	tools?: { listChanged?: boolean };
	resources?: { subscribe?: boolean; listChanged?: boolean };
	prompts?: { listChanged?: boolean };
	logging?: { levels?: string[] };
}

export interface McpClientInfo {
	name: string;
	version: string;
}

export interface McpServerInfo {
	name: string;
	version: string;
	capabilities?: McpCapabilities;
}

export interface McpInitializeParams {
	protocolVersion: string;
	clientInfo: McpClientInfo;
	capabilities?: {
		roots?: { listChanged?: boolean };
		sampling?: object;
	};
}

export interface McpInitializeResult {
	protocolVersion: string;
	serverInfo: McpServerInfo;
	capabilities?: McpCapabilities;
}

export interface McpTool {
	name: string;
	description?: string;
	inputSchema: {
		type: "object";
		properties?: Record<string, unknown>;
		required?: string[];
		[key: string]: unknown;
	};
}

export interface McpToolsListResult {
	tools: McpTool[];
	nextCursor?: string;
}

export interface McpToolCallParams {
	name: string;
	arguments?: McpJsonObject;
}

export interface McpToolCallResult {
	content: McpContent[];
	isError?: boolean;
}

export interface McpResource {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
}

export interface McpResourcesListResult {
	resources: McpResource[];
	nextCursor?: string;
}

export interface McpResourceReadParams {
	uri: string;
}

export interface McpResourceReadResult {
	contents: McpContent[];
}

export interface McpTextContent {
	type: "text";
	text: string;
}

export interface McpImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

export interface McpResourceContent {
	type: "resource";
	resource: { uri: string; text?: string; blob?: string; mimeType?: string };
}

export type McpContent = McpTextContent | McpImageContent | McpResourceContent;

export interface McpPrompt {
	name: string;
	description?: string;
	arguments?: {
		type: "object";
		properties?: Record<string, unknown>;
		required?: string[];
	};
}

export interface McpPromptsListResult {
	prompts: McpPrompt[];
	nextCursor?: string;
}

export interface IMcpClient {
	initialize(params: McpInitializeParams): Promise<McpInitializeResult>;
	listTools(cursor?: string): Promise<McpToolsListResult>;
	callTool(name: string, args?: McpJsonObject): Promise<McpToolCallResult>;
	listResources(cursor?: string): Promise<McpResourcesListResult>;
	readResource(uri: string): Promise<McpResourceReadResult>;
	listPrompts(cursor?: string): Promise<McpPromptsListResult>;
	close(): Promise<void>;
}

export type McpServerStatus = "starting" | "ready" | "error" | "stopped" | "needs_auth";

export interface McpServerInstance {
	name: string;
	config: McpServerConfig;
	status: McpServerStatus;
	serverInfo?: McpServerInfo;
	client?: IMcpClient;
	tools: McpTool[];
	resources: McpResource[];
	error?: string;
	pid?: number;
	startedAt?: Date;
}

export interface McpManagerState {
	servers: Map<string, McpServerInstance>;
	enabled: boolean;
	globalConfig?: McpConfig;
	projectConfig?: McpConfig;
}
