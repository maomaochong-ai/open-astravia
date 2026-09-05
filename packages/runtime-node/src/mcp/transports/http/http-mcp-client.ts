import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { McpHttpAuthProviderFactory } from "@vetta/runtime-mcp/client";
import { isMcpAuthRequiredError, McpAuthRequiredError } from "../../client/client-errors.js";
import type { McpClientHandle } from "../../client/client-handle.js";
import type {
	McpCancelTaskParams,
	McpCancelTaskResult,
	McpGetTaskParams,
	McpGetTaskResult,
	McpHttpServerConfig,
	McpInitializeParams,
	McpInitializeResult,
	McpJsonObject,
	McpPromptGetParams,
	McpPromptGetResult,
	McpPromptsListResult,
	McpRequestOptions,
	McpResourceReadResult,
	McpResourcesListResult,
	McpServerInteractionHandlers,
	McpSubscriptionFilter,
	McpSubscriptionHandler,
	McpSubscriptionsListenResult,
	McpTaskWaitOptions,
	McpToolCallResult,
	McpToolsListResult,
	McpUpdateTaskParams,
	McpUpdateTaskResult,
} from "../../protocol/index.js";
import { ModernStatelessMcpClient } from "./modern-stateless-mcp-client.js";
import {
	createMcpHttpSdkSession,
	isMcpSdkUnauthorizedError,
	type McpHttpSdkSession,
	type McpHttpSdkSessionFactory,
} from "./sdk-session-adapter.js";

const DEFAULT_TIMEOUT_MS = 30000;

export interface HttpMcpClientOptions {
	readonly config: McpHttpServerConfig;
	readonly name: string;
	readonly debug?: boolean;
	readonly timeout?: number;
	readonly authProviderFactory?: McpHttpAuthProviderFactory;
	readonly sdkSessionFactory?: McpHttpSdkSessionFactory;
	/** Injected only by transport contract tests; production uses the platform fetch. */
	readonly modernFetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
	readonly interactionHandlers?: McpServerInteractionHandlers;
	readonly maxInteractionRounds?: number;
	readonly onDiagnostic?: (message: string) => void;
}

/** Official MCP SDK adapter for Streamable HTTP, independent of product credential paths. */
export class HttpMcpClient implements McpClientHandle {
	private readonly name: string;
	private readonly config: McpHttpServerConfig;
	private readonly debug: boolean;
	private readonly timeout: number;
	private readonly authProviderFactory: McpHttpAuthProviderFactory | undefined;
	private readonly sdkSessionFactory: McpHttpSdkSessionFactory;
	private readonly modernFetch?: HttpMcpClientOptions["modernFetch"];
	private readonly interactionHandlers?: McpServerInteractionHandlers;
	private readonly maxInteractionRounds: number;
	private readonly onDiagnostic?: (message: string) => void;
	private session: McpHttpSdkSession | null = null;
	private modernClient: ModernStatelessMcpClient | null = null;
	private authProvider: OAuthClientProvider | undefined;
	private resolvedUrl: string | undefined;
	private initialized = false;

	constructor(options: HttpMcpClientOptions) {
		this.name = options.name;
		this.config = options.config;
		this.debug = options.debug || options.config.debug || false;
		this.timeout = options.timeout || options.config.startupTimeout || DEFAULT_TIMEOUT_MS;
		this.authProviderFactory = options.authProviderFactory;
		this.sdkSessionFactory = options.sdkSessionFactory ?? createMcpHttpSdkSession;
		this.modernFetch = options.modernFetch;
		this.interactionHandlers = options.interactionHandlers;
		this.maxInteractionRounds = Math.max(1, options.maxInteractionRounds ?? 3);
		this.onDiagnostic = options.onDiagnostic;
	}

	async initialize(params: McpInitializeParams): Promise<McpInitializeResult> {
		this.resolvedUrl = (await this.config.resolveUrl?.()) ?? this.config.url;
		const resolvedConfig = { ...this.config, url: this.resolvedUrl };
		this.authProvider = this.authProviderFactory?.({
			serverName: this.name,
			serverUrl: this.resolvedUrl,
			config: resolvedConfig,
		});
		if (this.config.protocolMode === "modern" || this.config.protocolMode === "auto") {
			this.modernClient = new ModernStatelessMcpClient({
				config: resolvedConfig,
				name: this.name,
				clientInfo: params.clientInfo,
				debug: this.debug,
				timeout: this.timeout,
				authProvider: this.authProvider,
				onDiagnostic: this.onDiagnostic,
				fetch: this.modernFetch,
				interactionHandlers: this.interactionHandlers,
				maxInteractionRounds: this.maxInteractionRounds,
			});
			try {
				const result = await this.modernClient.initialize(params);
				this.initialized = true;
				return result;
			} catch (error) {
				await this.modernClient.close();
				this.modernClient = null;
				if (isMcpSdkUnauthorizedError(error) || isMcpAuthRequiredError(error)) {
					throw new McpAuthRequiredError(this.name, this.resolvedUrl, getErrorMessage(error));
				}
				if (this.config.protocolMode === "modern") throw error;
				this.log("modern discovery unavailable; fallback=legacy");
			}
		}
		this.session = this.sdkSessionFactory({
			url: new URL(this.resolvedUrl),
			requestInit: this.config.headers ? { headers: this.config.headers } : undefined,
			fetch: buildHeaderResolvingFetch(this.config.resolveHeaders),
			authProvider: this.authProvider,
			clientInfo: params.clientInfo,
			capabilities: params.capabilities,
			timeout: this.timeout,
			serverName: this.name,
			interactionHandlers: this.interactionHandlers,
		});
		try {
			await this.session.connect();
		} catch (error) {
			await this.cleanupConnection();
			if (isMcpSdkUnauthorizedError(error)) {
				throw new McpAuthRequiredError(this.name, this.resolvedUrl, getErrorMessage(error));
			}
			throw error;
		}

		this.initialized = true;
		const serverVersion = this.session.getServerVersion();
		const serverCapabilities = this.session.getServerCapabilities();
		const protocolVersion = this.session.getProtocolVersion?.() ?? params.protocolVersion;
		this.log(`connected protocol=${protocolVersion}`);
		return {
			protocolVersion,
			serverInfo: {
				name: serverVersion?.name ?? this.name,
				version: serverVersion?.version ?? "unknown",
				capabilities: serverCapabilities,
			},
			capabilities: serverCapabilities,
		};
	}

	async listTools(cursor?: string, options?: McpRequestOptions): Promise<McpToolsListResult> {
		if (this.modernClient) return this.modernClient.listTools(cursor, options);
		return (await this.requireSession().listTools(cursor)) as McpToolsListResult;
	}

	async callTool(name: string, args?: McpJsonObject, options?: McpRequestOptions): Promise<McpToolCallResult> {
		try {
			if (this.modernClient) return await this.modernClient.callTool(name, args, options);
			return (await this.requireSession().callTool(name, args)) as McpToolCallResult;
		} catch (error) {
			this.log(`tool call failed tool=${name} error=${getErrorMessage(error)}`);
			if (isMcpSdkUnauthorizedError(error)) {
				this.initialized = false;
				throw new McpAuthRequiredError(this.name, this.resolvedUrl ?? this.config.url, getErrorMessage(error));
			}
			throw error;
		}
	}

	async listResources(cursor?: string, options?: McpRequestOptions): Promise<McpResourcesListResult> {
		if (this.modernClient) return this.modernClient.listResources(cursor, options);
		return (await this.requireSession().listResources(cursor)) as McpResourcesListResult;
	}

	async readResource(uri: string, options?: McpRequestOptions): Promise<McpResourceReadResult> {
		if (this.modernClient) return this.modernClient.readResource(uri, options);
		return (await this.requireSession().readResource(uri)) as McpResourceReadResult;
	}

	async listPrompts(cursor?: string, options?: McpRequestOptions): Promise<McpPromptsListResult> {
		if (this.modernClient) return this.modernClient.listPrompts(cursor, options);
		return (await this.requireSession().listPrompts(cursor)) as McpPromptsListResult;
	}

	async getPrompt(params: McpPromptGetParams, options?: McpRequestOptions): Promise<McpPromptGetResult> {
		if (this.modernClient) return this.modernClient.getPrompt(params, options);
		return (await this.requireSession().getPrompt(params.name, params.arguments)) as McpPromptGetResult;
	}

	async getTask(params: McpGetTaskParams, options?: McpRequestOptions): Promise<McpGetTaskResult> {
		if (!this.modernClient) throw new Error("MCP Tasks require protocolMode=modern");
		return this.modernClient.getTask(params, options);
	}

	async updateTask(params: McpUpdateTaskParams, options?: McpRequestOptions): Promise<McpUpdateTaskResult> {
		if (!this.modernClient) throw new Error("MCP Tasks require protocolMode=modern");
		return this.modernClient.updateTask(params, options);
	}

	async cancelTask(params: McpCancelTaskParams, options?: McpRequestOptions): Promise<McpCancelTaskResult> {
		if (!this.modernClient) throw new Error("MCP Tasks require protocolMode=modern");
		return this.modernClient.cancelTask(params, options);
	}

	async waitForTask(params: McpGetTaskParams, options?: McpTaskWaitOptions): Promise<McpGetTaskResult> {
		if (!this.modernClient) throw new Error("MCP Tasks require protocolMode=modern");
		return this.modernClient.waitForTask(params, options);
	}

	async listenSubscriptions(
		filter: McpSubscriptionFilter,
		onNotification: McpSubscriptionHandler,
		options?: McpRequestOptions,
	): Promise<McpSubscriptionsListenResult> {
		if (!this.modernClient) throw new Error("MCP subscriptions require the 2026-07-28 protocol");
		return this.modernClient.listenSubscriptions(filter, onNotification, options);
	}

	async close(): Promise<void> {
		if (this.modernClient) {
			await this.modernClient.close();
			this.modernClient = null;
		}
		await this.cleanupConnection();
		this.initialized = false;
		this.resolvedUrl = undefined;
	}

	getName(): string {
		return this.name;
	}

	getPid(): number | undefined {
		if (this.modernClient) return this.modernClient.getPid();
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
		const formatted = `[MCPClient:${this.name}] ${message}`;
		if (this.onDiagnostic) this.onDiagnostic(formatted);
		else if (this.debug) console.error(formatted);
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
