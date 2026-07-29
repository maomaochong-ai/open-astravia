/**
 * MCP (Model Context Protocol) Type Definitions
 *
 * Based on the MCP specification for connecting AI assistants to external tools and data sources.
 */

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Common fields shared by all MCP server transports
 */
export interface McpServerCommonConfig {
	/** Whether this server is disabled */
	disabled?: boolean;
	/** List of tool names that should be auto-approved without user confirmation */
	autoApprove?: string[];
	/** Timeout in milliseconds for server startup (default: 10000) */
	startupTimeout?: number;
	/** Whether to enable debug logging for this server */
	debug?: boolean;
	/** Optional human-readable label for UIs that list servers. The agent itself
	 * keys servers by their object key; this field is purely cosmetic. */
	displayName?: string;
	/** Optional UI-only description (purely cosmetic, ignored by the agent). */
	description?: string;
}

/**
 * Configuration for an MCP server launched as a local child process (stdio transport)
 */
export interface McpStdioServerConfig extends McpServerCommonConfig {
	/** Transport type. Omitting this field defaults to stdio for backwards compat. */
	type?: "stdio";
	/** Command to execute (e.g., "npx", "node", "/path/to/binary") */
	command: string;
	/** Command arguments */
	args?: string[];
	/** Environment variables for the server process */
	env?: Record<string, string>;
	/** Working directory for the server process (supports ${PROJECT_ROOT} variable) */
	cwd?: string;
}

/**
 * Configuration for an MCP server accessed over Streamable HTTP transport
 */
export interface McpHttpServerConfig extends McpServerCommonConfig {
	type: "http";
	/** Server endpoint URL (supports ${VAR} substitution) */
	url: string;
	/** Optional HTTP headers sent with every request (supports ${VAR} substitution) */
	headers?: Record<string, string>;
	/**
	 * Pre-registered OAuth client_id for servers that do NOT support Dynamic Client
	 * Registration (e.g. GitHub). Public client + PKCE, no client_secret. When set,
	 * the OAuth flow seeds this client_id and skips DCR.
	 */
	oauthClientId?: string;
	/**
	 * Use the OAuth 2.0 Device Authorization Grant instead of the authorization-code
	 * flow. Needed for providers that require a client_secret for the code flow but
	 * allow the device flow with only a client_id (e.g. GitHub).
	 */
	oauthDeviceFlow?: boolean;
	/** Space-separated OAuth scopes to request during the device flow. */
	oauthScopes?: string;
	/**
	 * Per-request header provider. **Runtime-only — never present in mcp.json**
	 * (JSON cannot carry a function); only code-constructed servers set it.
	 *
	 * Why this exists: `headers` is baked into the transport when the connection is
	 * established, so a rotating credential goes stale the moment it rotates and the
	 * server 401s until the whole client restarts. A provider is consulted on every
	 * request, so the connection always carries the current token.
	 *
	 * Merged over `headers`, so a static header of the same name loses.
	 */
	resolveHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
}

/**
 * Configuration for a single MCP server
 */
export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

/**
 * Returns true if the config uses the HTTP transport
 */
export function isHttpServerConfig(config: McpServerConfig): config is McpHttpServerConfig {
	return config.type === "http";
}

/**
 * Returns true if the config uses the stdio transport
 */
export function isStdioServerConfig(config: McpServerConfig): config is McpStdioServerConfig {
	return config.type === undefined || config.type === "stdio";
}

/**
 * Root MCP configuration structure
 */
export interface McpConfig {
	/** Map of server name to server configuration */
	mcpServers: Record<string, McpServerConfig>;
}

// ============================================================================
// JSON-RPC 2.0 Protocol Types
// ============================================================================

/**
 * JSON-RPC 2.0 Request
 */
export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: string | number;
	method: string;
	params?: any;
}

/**
 * JSON-RPC 2.0 Success Response
 */
export interface JsonRpcSuccessResponse {
	jsonrpc: "2.0";
	id: string | number;
	result: any;
}

/**
 * JSON-RPC 2.0 Error Response
 */
export interface JsonRpcErrorResponse {
	jsonrpc: "2.0";
	id: string | number;
	error: {
		code: number;
		message: string;
		data?: any;
	};
}

/**
 * JSON-RPC 2.0 Notification (no id, no response expected)
 */
export interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: any;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ============================================================================
// MCP Protocol Types
// ============================================================================

/**
 * MCP Server Capabilities
 */
export interface McpCapabilities {
	tools?: {
		/** Whether the server supports listing available tools */
		listChanged?: boolean;
	};
	resources?: {
		/** Whether the server supports subscribing to resource changes */
		subscribe?: boolean;
		/** Whether the server supports listing available resources */
		listChanged?: boolean;
	};
	prompts?: {
		/** Whether the server supports listing available prompts */
		listChanged?: boolean;
	};
	logging?: {
		/** Supported log levels */
		levels?: string[];
	};
}

/**
 * MCP Client Information
 */
export interface McpClientInfo {
	name: string;
	version: string;
}

/**
 * MCP Server Information
 */
export interface McpServerInfo {
	name: string;
	version: string;
	capabilities?: McpCapabilities;
}

/**
 * MCP Initialize Request Parameters
 */
export interface McpInitializeParams {
	protocolVersion: string;
	clientInfo: McpClientInfo;
	capabilities?: {
		roots?: {
			listChanged?: boolean;
		};
		sampling?: object;
	};
}

/**
 * MCP Initialize Response
 */
export interface McpInitializeResult {
	protocolVersion: string;
	serverInfo: McpServerInfo;
	capabilities?: McpCapabilities;
}

// ============================================================================
// MCP Tool Types
// ============================================================================

/**
 * MCP Tool Definition (JSON Schema based)
 */
export interface McpTool {
	/** Unique tool name */
	name: string;
	/** Human-readable description */
	description?: string;
	/** JSON Schema for tool parameters */
	inputSchema: {
		type: "object";
		properties?: Record<string, any>;
		required?: string[];
		[key: string]: any;
	};
}

/**
 * MCP Tools List Response
 */
export interface McpToolsListResult {
	tools: McpTool[];
	/** Optional pagination cursor */
	nextCursor?: string;
}

/**
 * MCP Tool Call Parameters
 */
export interface McpToolCallParams {
	name: string;
	arguments?: Record<string, any>;
}

/**
 * MCP Tool Call Result
 */
export interface McpToolCallResult {
	/** Array of content blocks (text, image, resource reference) */
	content: McpContent[];
	/** Whether this is an error result */
	isError?: boolean;
}

// ============================================================================
// MCP Resource Types
// ============================================================================

/**
 * MCP Resource Reference
 */
export interface McpResource {
	/** Resource URI (e.g., "file:///path/to/file") */
	uri: string;
	/** Human-readable name */
	name: string;
	/** Optional description */
	description?: string;
	/** Optional MIME type */
	mimeType?: string;
}

/**
 * MCP Resources List Response
 */
export interface McpResourcesListResult {
	resources: McpResource[];
	/** Optional pagination cursor */
	nextCursor?: string;
}

/**
 * MCP Resource Read Parameters
 */
export interface McpResourceReadParams {
	uri: string;
}

/**
 * MCP Resource Read Result
 */
export interface McpResourceReadResult {
	/** Array of content blocks */
	contents: McpContent[];
}

// ============================================================================
// MCP Content Types
// ============================================================================

/**
 * MCP Text Content
 */
export interface McpTextContent {
	type: "text";
	text: string;
}

/**
 * MCP Image Content (base64 encoded)
 */
export interface McpImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

/**
 * MCP Resource Content (reference to a resource)
 */
export interface McpResourceContent {
	type: "resource";
	resource: {
		uri: string;
		text?: string;
		blob?: string; // base64 encoded
		mimeType?: string;
	};
}

export type McpContent = McpTextContent | McpImageContent | McpResourceContent;

// ============================================================================
// MCP Prompt Types
// ============================================================================

/**
 * MCP Prompt Definition
 */
export interface McpPrompt {
	/** Unique prompt name */
	name: string;
	/** Optional description */
	description?: string;
	/** Optional arguments schema */
	arguments?: {
		type: "object";
		properties?: Record<string, any>;
		required?: string[];
	};
}

/**
 * MCP Prompts List Response
 */
export interface McpPromptsListResult {
	prompts: McpPrompt[];
	/** Optional pagination cursor */
	nextCursor?: string;
}

// ============================================================================
// MCP Client Interface
// ============================================================================

/**
 * MCP Client for communicating with an MCP server
 */
export interface IMcpClient {
	/** Initialize the connection */
	initialize(params: McpInitializeParams): Promise<McpInitializeResult>;

	/** List available tools */
	listTools(cursor?: string): Promise<McpToolsListResult>;

	/** Call a tool */
	callTool(name: string, args?: Record<string, any>): Promise<McpToolCallResult>;

	/** List available resources */
	listResources(cursor?: string): Promise<McpResourcesListResult>;

	/** Read a resource */
	readResource(uri: string): Promise<McpResourceReadResult>;

	/** List available prompts */
	listPrompts(cursor?: string): Promise<McpPromptsListResult>;

	/** Close the connection */
	close(): Promise<void>;
}

// ============================================================================
// MCP Manager Types
// ============================================================================

/**
 * MCP Server Status
 */
export type McpServerStatus = "starting" | "ready" | "error" | "stopped" | "needs_auth";

/**
 * MCP Server Instance State
 */
export interface McpServerInstance {
	/** Server name (from config) */
	name: string;
	/** Server configuration */
	config: McpServerConfig;
	/** Current status */
	status: McpServerStatus;
	/** Server info (available after initialization) */
	serverInfo?: McpServerInfo;
	/** MCP client instance */
	client?: IMcpClient;
	/** Available tools */
	tools: McpTool[];
	/** Available resources */
	resources: McpResource[];
	/** Error message if status is "error" or "needs_auth" */
	error?: string;
	/** Process ID (if applicable) */
	pid?: number;
	/** Startup timestamp */
	startedAt?: Date;
}

/**
 * MCP Manager State
 */
export interface McpManagerState {
	/** Map of server name to server instance */
	servers: Map<string, McpServerInstance>;
	/** Whether MCP is globally enabled */
	enabled: boolean;
	/** Global config */
	globalConfig?: McpConfig;
	/** Project config */
	projectConfig?: McpConfig;
}
