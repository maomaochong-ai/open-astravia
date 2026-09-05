/** Transport-neutral MCP protocol and configuration contracts. */

import type { McpCacheScope } from "./cache.js";
import type { McpJsonObject, McpJsonValue, McpMeta } from "./json.js";
import type { McpSubscriptionFilter, McpSubscriptionHandler, McpSubscriptionsListenResult } from "./subscriptions.js";
import type {
	McpCancelTaskParams,
	McpCancelTaskResult,
	McpGetTaskParams,
	McpGetTaskResult,
	McpTaskWaitOptions,
	McpUpdateTaskParams,
	McpUpdateTaskResult,
} from "./tasks.js";
import type { McpProtocolMode } from "./versions.js";

export interface McpAnnotations {
	readonly audience?: readonly ("user" | "assistant")[];
	readonly priority?: number;
	readonly lastModified?: string;
}

export interface McpIcon {
	readonly src: string;
	readonly mimeType?: string;
	readonly sizes?: string[];
	readonly theme?: "light" | "dark";
}

export interface McpToolAnnotations {
	readonly title?: string;
	readonly readOnlyHint?: boolean;
	readonly destructiveHint?: boolean;
	readonly idempotentHint?: boolean;
	readonly openWorldHint?: boolean;
}

export interface McpServerCommonConfig {
	disabled?: boolean;
	autoApprove?: string[];
	startupTimeout?: number;
	debug?: boolean;
	displayName?: string;
	description?: string;
	/** Selects the wire protocol strategy; legacy remains the compatibility default. */
	protocolMode?: McpProtocolMode;
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
	/** Host-managed process environment overrides; ignored by ordinary remote HTTP transports. */
	managedRuntimeEnv?: Record<string, string>;
	/** Runtime-only URL resolver for host-managed local services; never persisted to mcp.json. */
	resolveUrl?: () => string | Promise<string>;
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
	experimental?: Record<string, McpJsonObject>;
	tools?: { listChanged?: boolean };
	resources?: { subscribe?: boolean; listChanged?: boolean };
	prompts?: { listChanged?: boolean };
	completions?: McpJsonObject;
	logging?: { levels?: string[] };
	extensions?: Record<string, McpJsonObject>;
}

export interface McpClientInfo {
	name: string;
	version: string;
	title?: string;
	description?: string;
	websiteUrl?: string;
	icons?: McpIcon[];
}

export interface McpServerInfo {
	name: string;
	version: string;
	title?: string;
	description?: string;
	websiteUrl?: string;
	icons?: McpIcon[];
	capabilities?: McpCapabilities;
}

export interface McpInitializeParams {
	protocolVersion: string;
	clientInfo: McpClientInfo;
	capabilities?: {
		roots?: { listChanged?: boolean };
		sampling?: object;
		elicitation?: { form?: McpJsonObject; url?: McpJsonObject };
		extensions?: Record<string, McpJsonObject>;
	};
}

export interface McpInitializeResult {
	protocolVersion: string;
	serverInfo: McpServerInfo;
	capabilities?: McpCapabilities;
}

export interface McpTool {
	name: string;
	title?: string;
	description?: string;
	icons?: McpIcon[];
	inputSchema: {
		type: "object";
		properties?: Record<string, unknown>;
		required?: string[];
		[key: string]: unknown;
	};
	outputSchema?: Record<string, unknown>;
	annotations?: McpToolAnnotations;
	_meta?: McpMeta;
}

export interface McpToolsListResult {
	tools: McpTool[];
	nextCursor?: string;
	resultType?: string;
	ttlMs?: number;
	cacheScope?: McpCacheScope;
	_meta?: McpMeta;
}

export interface McpToolCallParams {
	name: string;
	arguments?: McpJsonObject;
}

/** Per-call host options. These fields are not serialized unless a transport explicitly maps them. */
export interface McpRequestOptions {
	readonly signal?: AbortSignal;
	readonly forceRefresh?: boolean;
	readonly sessionId?: string;
	readonly turnId?: string;
	readonly toolCallId?: string;
}

export interface McpToolCallResult {
	content: McpContent[];
	structuredContent?: McpJsonValue;
	isError?: boolean;
	resultType?: string;
	_meta?: McpMeta;
}

export interface McpResource {
	uri: string;
	name: string;
	title?: string;
	description?: string;
	mimeType?: string;
	size?: number;
	icons?: McpIcon[];
	annotations?: McpAnnotations;
	_meta?: McpMeta;
}

export interface McpResourcesListResult {
	resources: McpResource[];
	nextCursor?: string;
	resultType?: string;
	ttlMs?: number;
	cacheScope?: McpCacheScope;
	_meta?: McpMeta;
}

export interface McpResourceReadParams {
	uri: string;
}

export interface McpResourceReadResult {
	contents: McpResourceContents[];
	resultType?: string;
	ttlMs?: number;
	cacheScope?: McpCacheScope;
	_meta?: McpMeta;
}

export interface McpTextContent {
	type: "text";
	text: string;
	annotations?: McpAnnotations;
	_meta?: McpMeta;
}

export interface McpImageContent {
	type: "image";
	data: string;
	mimeType: string;
	annotations?: McpAnnotations;
	_meta?: McpMeta;
}

export interface McpAudioContent {
	type: "audio";
	data: string;
	mimeType: string;
	annotations?: McpAnnotations;
	_meta?: McpMeta;
}

export interface McpTextResourceContents {
	uri: string;
	mimeType?: string;
	_meta?: McpMeta;
	text: string;
}

export interface McpBlobResourceContents {
	uri: string;
	mimeType?: string;
	_meta?: McpMeta;
	blob: string;
}

export type McpResourceContents = McpTextResourceContents | McpBlobResourceContents;

export interface McpResourceLinkContent {
	type: "resource_link";
	uri: string;
	name: string;
	title?: string;
	description?: string;
	mimeType?: string;
	annotations?: McpAnnotations;
	_meta?: McpMeta;
}

/** EmbeddedResource is a ToolResult content block, not a resources/read result. */
export interface McpEmbeddedResourceContent {
	type: "resource";
	resource: McpResourceContents;
	annotations?: McpAnnotations;
	_meta?: McpMeta;
}

/** Backwards-compatible name retained for existing MCP tool integrations. */
export type McpResourceContent = McpEmbeddedResourceContent;

export type McpContent =
	| McpTextContent
	| McpImageContent
	| McpAudioContent
	| McpResourceLinkContent
	| McpEmbeddedResourceContent;

export interface McpPrompt {
	name: string;
	title?: string;
	description?: string;
	arguments?: McpPromptArgument[];
	icons?: McpIcon[];
	_meta?: McpMeta;
}

export interface McpPromptArgument {
	name: string;
	title?: string;
	description?: string;
	required?: boolean;
}

export interface McpPromptsListResult {
	prompts: McpPrompt[];
	nextCursor?: string;
	resultType?: string;
	ttlMs?: number;
	cacheScope?: McpCacheScope;
	_meta?: McpMeta;
}

export interface McpPromptGetParams {
	readonly name: string;
	readonly arguments?: Record<string, string>;
}

export interface McpPromptMessage {
	readonly role: "user" | "assistant";
	readonly content: McpContent;
}

export interface McpPromptGetResult {
	readonly description?: string;
	readonly messages: McpPromptMessage[];
	readonly resultType?: string;
	readonly _meta?: McpMeta;
}

export interface IMcpClient {
	initialize(params: McpInitializeParams): Promise<McpInitializeResult>;
	listTools(cursor?: string, options?: McpRequestOptions): Promise<McpToolsListResult>;
	callTool(name: string, args?: McpJsonObject, options?: McpRequestOptions): Promise<McpToolCallResult>;
	listResources(cursor?: string, options?: McpRequestOptions): Promise<McpResourcesListResult>;
	readResource(uri: string, options?: McpRequestOptions): Promise<McpResourceReadResult>;
	listPrompts(cursor?: string, options?: McpRequestOptions): Promise<McpPromptsListResult>;
	getPrompt?(params: McpPromptGetParams, options?: McpRequestOptions): Promise<McpPromptGetResult>;
	getTask?(params: McpGetTaskParams, options?: McpRequestOptions): Promise<McpGetTaskResult>;
	updateTask?(params: McpUpdateTaskParams, options?: McpRequestOptions): Promise<McpUpdateTaskResult>;
	cancelTask?(params: McpCancelTaskParams, options?: McpRequestOptions): Promise<McpCancelTaskResult>;
	waitForTask?(params: McpGetTaskParams, options?: McpTaskWaitOptions): Promise<McpGetTaskResult>;
	listenSubscriptions?(
		filter: McpSubscriptionFilter,
		onNotification: McpSubscriptionHandler,
		options?: McpRequestOptions,
	): Promise<McpSubscriptionsListenResult>;
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
