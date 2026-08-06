import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { McpAuthRequiredError } from "../../client/client-errors.js";
import type { McpClientHandle } from "../../client/client-handle.js";
import type {
	McpHttpServerConfig,
	McpInitializeParams,
	McpInitializeResult,
	McpJsonObject,
	McpPromptsListResult,
	McpResourceReadResult,
	McpResourcesListResult,
	McpToolCallResult,
	McpToolsListResult,
} from "../../protocol/index.js";
import {
	createMcpHttpSdkSession,
	isMcpSdkUnauthorizedError,
	type McpHttpSdkSession,
	type McpHttpSdkSessionFactory,
} from "./sdk-session-adapter.js";

const DEFAULT_TIMEOUT_MS = 30000;

export interface McpHttpAuthProviderContext {
	readonly serverName: string;
	readonly serverUrl: string;
	readonly config: McpHttpServerConfig;
}

export type McpHttpAuthProviderFactory = (context: McpHttpAuthProviderContext) => OAuthClientProvider | undefined;

export interface HttpMcpClientOptions {
	readonly config: McpHttpServerConfig;
	readonly name: string;
	readonly debug?: boolean;
	readonly timeout?: number;
	readonly authProviderFactory?: McpHttpAuthProviderFactory;
	readonly sdkSessionFactory?: McpHttpSdkSessionFactory;
}

/** Official MCP SDK adapter for Streamable HTTP, independent of product credential paths. */
export class HttpMcpClient implements McpClientHandle {
	private readonly name: string;
	private readonly config: McpHttpServerConfig;
	private readonly debug: boolean;
	private readonly timeout: number;
	private readonly authProviderFactory: McpHttpAuthProviderFactory | undefined;
	private readonly sdkSessionFactory: McpHttpSdkSessionFactory;
	private session: McpHttpSdkSession | null = null;
	private authProvider: OAuthClientProvider | undefined;
	private initialized = false;

	constructor(options: HttpMcpClientOptions) {
		this.name = options.name;
		this.config = options.config;
		this.debug = options.debug || options.config.debug || false;
		this.timeout = options.timeout || options.config.startupTimeout || DEFAULT_TIMEOUT_MS;
		this.authProviderFactory = options.authProviderFactory;
		this.sdkSessionFactory = options.sdkSessionFactory ?? createMcpHttpSdkSession;
	}

	async initialize(params: McpInitializeParams): Promise<McpInitializeResult> {
		this.authProvider = this.authProviderFactory?.({
			serverName: this.name,
			serverUrl: this.config.url,
			config: this.config,
		});
		this.session = this.sdkSessionFactory({
			url: new URL(this.config.url),
			requestInit: this.config.headers ? { headers: this.config.headers } : undefined,
			fetch: buildHeaderResolvingFetch(this.config.resolveHeaders),
			authProvider: this.authProvider,
			clientInfo: params.clientInfo,
			capabilities: params.capabilities,
			timeout: this.timeout,
		});
		try {
			await this.session.connect();
		} catch (error) {
			await this.cleanupConnection();
			if (isMcpSdkUnauthorizedError(error)) {
				throw new McpAuthRequiredError(this.name, this.config.url, getErrorMessage(error));
			}
			throw error;
		}

		this.initialized = true;
		const serverVersion = this.session.getServerVersion();
		const serverCapabilities = this.session.getServerCapabilities();
		this.log(`Connected to ${this.config.url}`);
		return {
			protocolVersion: params.protocolVersion,
			serverInfo: {
				name: serverVersion?.name ?? this.name,
				version: serverVersion?.version ?? "unknown",
				capabilities: serverCapabilities,
			},
			capabilities: serverCapabilities,
		};
	}

	async listTools(cursor?: string): Promise<McpToolsListResult> {
		return (await this.requireSession().listTools(cursor)) as McpToolsListResult;
	}

	async callTool(name: string, args?: McpJsonObject): Promise<McpToolCallResult> {
		try {
			return (await this.requireSession().callTool(name, args)) as McpToolCallResult;
		} catch (error) {
			if (isMcpSdkUnauthorizedError(error)) {
				this.initialized = false;
				throw new McpAuthRequiredError(this.name, this.config.url, getErrorMessage(error));
			}
			throw error;
		}
	}

	async listResources(cursor?: string): Promise<McpResourcesListResult> {
		return (await this.requireSession().listResources(cursor)) as McpResourcesListResult;
	}

	async readResource(uri: string): Promise<McpResourceReadResult> {
		return (await this.requireSession().readResource(uri)) as McpResourceReadResult;
	}

	async listPrompts(cursor?: string): Promise<McpPromptsListResult> {
		return (await this.requireSession().listPrompts(cursor)) as McpPromptsListResult;
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

	private requireSession(): McpHttpSdkSession {
		if (!this.initialized || !this.session) throw new Error("HTTP MCP client is not initialized");
		return this.session;
	}

	private async cleanupConnection(): Promise<void> {
		if (this.session) {
			try {
				await this.session.close();
			} catch (error) {
				this.log(`Error closing client: ${getErrorMessage(error)}`);
			}
		}
		this.session = null;
		this.authProvider = undefined;
	}

	private log(message: string): void {
		if (this.debug) console.error(`[MCPClient:${this.name}] ${message}`);
	}
}

function buildHeaderResolvingFetch(
	resolveHeaders: McpHttpServerConfig["resolveHeaders"],
): ((input: string | URL, init?: RequestInit) => Promise<Response>) | undefined {
	if (!resolveHeaders) return undefined;
	return async (input, init) => {
		const headers = new Headers(init?.headers);
		try {
			for (const [key, value] of Object.entries(await resolveHeaders())) headers.set(key, value);
		} catch {
			// Let the server return its normal authentication response when credentials cannot be refreshed.
		}
		return fetch(input, { ...init, headers });
	};
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
