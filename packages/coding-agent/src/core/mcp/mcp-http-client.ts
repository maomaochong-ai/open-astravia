/**
 * MCP HTTP Client
 *
 * Implements IMcpClient using the official @modelcontextprotocol/sdk
 * with Streamable HTTP transport and optional OAuth (MCP remote auth).
 */

import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getAgentDir } from "../../config.js";
import { FileMcpOAuthProvider } from "./mcp-oauth-provider.js";
import { hasMcpOAuthTokens, loadMcpOAuthState } from "./mcp-oauth-storage.js";
import type {
	IMcpClient,
	McpHttpServerConfig,
	McpInitializeParams,
	McpInitializeResult,
	McpPromptsListResult,
	McpResourceReadResult,
	McpResourcesListResult,
	McpToolCallResult,
	McpToolsListResult,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 30000;

/** Thrown when a remote MCP server requires OAuth and no valid session exists. */
export class McpAuthRequiredError extends Error {
	readonly code = "MCP_AUTH_REQUIRED" as const;
	readonly serverName: string;
	readonly serverUrl: string;

	constructor(serverName: string, serverUrl: string, message?: string) {
		super(message ?? `MCP server '${serverName}' requires OAuth authorization`);
		this.name = "McpAuthRequiredError";
		this.serverName = serverName;
		this.serverUrl = serverUrl;
	}
}

export function isMcpAuthRequiredError(error: unknown): error is McpAuthRequiredError {
	return error instanceof McpAuthRequiredError || (error as { code?: string })?.code === "MCP_AUTH_REQUIRED";
}

export interface HttpMcpClientOptions {
	config: McpHttpServerConfig;
	name: string;
	debug?: boolean;
	timeout?: number;
	/** Agent dir for OAuth token storage */
	agentDir?: string;
}

export class HttpMcpClient implements IMcpClient {
	private name: string;
	private config: McpHttpServerConfig;
	private debug: boolean;
	private timeout: number;
	private agentDir: string;
	private client: Client | null = null;
	private transport: StreamableHTTPClientTransport | null = null;
	private oauthProvider: FileMcpOAuthProvider | null = null;
	private initialized = false;

	constructor(options: HttpMcpClientOptions) {
		this.name = options.name;
		this.config = options.config;
		this.debug = options.debug || options.config.debug || false;
		this.timeout = options.timeout || options.config.startupTimeout || DEFAULT_TIMEOUT_MS;
		this.agentDir = options.agentDir ?? getAgentDir();
	}

	async initialize(params: McpInitializeParams): Promise<McpInitializeResult> {
		const url = new URL(this.config.url);
		const requestInit: RequestInit | undefined = this.config.headers ? { headers: this.config.headers } : undefined;

		// Only attach OAuth when we already have tokens for this server.
		// Public HTTP MCPs (e.g. web search) need no auth — do not force OAuth discovery.
		// Servers that require OAuth without tokens still throw UnauthorizedError → needs_auth;
		// interactive login is handled by loginHttpMcpServer / McpManager.loginServer.
		const useOAuth = hasMcpOAuthTokens(this.name, this.agentDir);

		if (useOAuth) {
			// Connect path: reuse stored redirect_uri so we do not invalidate DCR client info.
			this.oauthProvider = new FileMcpOAuthProvider({
				serverName: this.name,
				serverUrl: this.config.url,
				redirectUri: loadRedirectUri(this.name, this.agentDir) ?? "http://127.0.0.1/callback",
				agentDir: this.agentDir,
				clientId: this.config.oauthClientId,
				onRedirect: () => {
					// Non-interactive: transport throws UnauthorizedError → needs_auth
				},
			});
		}

		this.transport = new StreamableHTTPClientTransport(url, {
			requestInit,
			authProvider: this.oauthProvider ?? undefined,
			fetch: buildHeaderResolvingFetch(this.config.resolveHeaders),
		});
		this.client = new Client(
			{ name: params.clientInfo.name, version: params.clientInfo.version },
			{ capabilities: params.capabilities ?? {} },
		);

		try {
			await this.client.connect(this.transport, { timeout: this.timeout });
		} catch (error) {
			await this.cleanupConnection();
			if (error instanceof UnauthorizedError || isUnauthorizedLike(error)) {
				throw new McpAuthRequiredError(this.name, this.config.url, (error as Error).message);
			}
			throw error;
		}

		this.initialized = true;

		const serverVersion = this.client.getServerVersion();
		const serverCapabilities = this.client.getServerCapabilities();

		this.log(`Connected to ${this.config.url}`);

		return {
			protocolVersion: params.protocolVersion,
			serverInfo: {
				name: serverVersion?.name ?? this.name,
				version: serverVersion?.version ?? "unknown",
				capabilities: serverCapabilities as McpInitializeResult["serverInfo"]["capabilities"],
			},
			capabilities: serverCapabilities as McpInitializeResult["capabilities"],
		};
	}

	async listTools(cursor?: string): Promise<McpToolsListResult> {
		this.ensureInitialized();
		const result = await this.client!.listTools(cursor ? { cursor } : undefined);
		return result as unknown as McpToolsListResult;
	}

	async callTool(name: string, args?: Record<string, any>): Promise<McpToolCallResult> {
		this.ensureInitialized();
		try {
			const result = await this.client!.callTool({ name, arguments: args });
			return result as unknown as McpToolCallResult;
		} catch (error) {
			if (error instanceof UnauthorizedError || isUnauthorizedLike(error)) {
				this.initialized = false;
				throw new McpAuthRequiredError(this.name, this.config.url, (error as Error).message);
			}
			throw error;
		}
	}

	async listResources(cursor?: string): Promise<McpResourcesListResult> {
		this.ensureInitialized();
		const result = await this.client!.listResources(cursor ? { cursor } : undefined);
		return result as unknown as McpResourcesListResult;
	}

	async readResource(uri: string): Promise<McpResourceReadResult> {
		this.ensureInitialized();
		const result = await this.client!.readResource({ uri });
		return result as unknown as McpResourceReadResult;
	}

	async listPrompts(cursor?: string): Promise<McpPromptsListResult> {
		this.ensureInitialized();
		const result = await this.client!.listPrompts(cursor ? { cursor } : undefined);
		return result as unknown as McpPromptsListResult;
	}

	async close(): Promise<void> {
		await this.cleanupConnection();
		this.initialized = false;
	}

	getName(): string {
		return this.name;
	}

	getPid(): number | undefined {
		return undefined;
	}

	isClientInitialized(): boolean {
		return this.initialized;
	}

	private async cleanupConnection(): Promise<void> {
		if (this.client) {
			try {
				await this.client.close();
			} catch (error) {
				this.log(`Error closing client: ${(error as Error).message}`);
			}
		}
		this.client = null;
		this.transport = null;
		this.oauthProvider = null;
	}

	private ensureInitialized(): void {
		if (!this.initialized || !this.client) {
			throw new Error("HTTP MCP client is not initialized");
		}
	}

	private log(message: string): void {
		if (this.debug) {
			console.error(`[MCPClient:${this.name}] ${message}`);
		}
	}
}

/**
 * Wrap global fetch so `resolveHeaders` is consulted on every request.
 *
 * Returns undefined when there is no provider, letting the SDK use its own default
 * fetch — we only pay for the indirection where a rotating credential needs it.
 *
 * A failing provider must not take the request down: a transient read error on the
 * credential file should surface as the server's own 401, which callers already
 * handle, rather than as an opaque transport crash.
 */
function buildHeaderResolvingFetch(
	resolveHeaders: McpHttpServerConfig["resolveHeaders"],
): ((input: string | URL, init?: RequestInit) => Promise<Response>) | undefined {
	if (!resolveHeaders) return undefined;

	return async (input, init) => {
		const headers = new Headers(init?.headers);
		try {
			for (const [key, value] of Object.entries(await resolveHeaders())) {
				headers.set(key, value);
			}
		} catch {
			// Fall through with whatever static headers exist.
		}
		return fetch(input, { ...init, headers });
	};
}

function isUnauthorizedLike(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const message = String((error as Error).message ?? "").toLowerCase();
	return message.includes("unauthorized") || message.includes("401");
}

function loadRedirectUri(serverName: string, agentDir: string): string | undefined {
	return loadMcpOAuthState(serverName, agentDir)?.redirectUri;
}
