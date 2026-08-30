import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
	CreateMessageRequestSchema,
	ElicitRequestSchema,
	ListRootsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type {
	McpCapabilities,
	McpClientInfo,
	McpElicitationCreateParams,
	McpJsonObject,
	McpSamplingCreateMessageParams,
	McpServerInteractionHandlers,
} from "../../protocol/index.js";

export interface McpHttpSdkSessionOptions {
	readonly url: URL;
	readonly requestInit?: RequestInit;
	readonly fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
	readonly authProvider?: OAuthClientProvider;
	readonly clientInfo: McpClientInfo;
	readonly capabilities?: { roots?: { listChanged?: boolean }; sampling?: object };
	readonly timeout: number;
	readonly serverName: string;
	readonly interactionHandlers?: McpServerInteractionHandlers;
}

export interface McpHttpSdkSession {
	connect(): Promise<void>;
	getProtocolVersion?(): string | undefined;
	getServerVersion(): { name: string; version: string } | undefined;
	getServerCapabilities(): McpCapabilities | undefined;
	listTools(cursor?: string): Promise<unknown>;
	callTool(name: string, args?: McpJsonObject): Promise<unknown>;
	listResources(cursor?: string): Promise<unknown>;
	readResource(uri: string): Promise<unknown>;
	listPrompts(cursor?: string): Promise<unknown>;
	getPrompt(name: string, args?: Record<string, string>): Promise<unknown>;
	close(): Promise<void>;
}

export type McpHttpSdkSessionFactory = (options: McpHttpSdkSessionOptions) => McpHttpSdkSession;

export const createMcpHttpSdkSession: McpHttpSdkSessionFactory = (options) => new DefaultMcpHttpSdkSession(options);

export function isMcpSdkUnauthorizedError(error: unknown): boolean {
	if (error instanceof UnauthorizedError) return true;
	if (!error || typeof error !== "object") return false;
	const message = String("message" in error ? error.message : "").toLowerCase();
	return message.includes("unauthorized") || message.includes("401");
}

class DefaultMcpHttpSdkSession implements McpHttpSdkSession {
	private readonly transport: StreamableHTTPClientTransport;
	private readonly client: Client;

	constructor(private readonly options: McpHttpSdkSessionOptions) {
		this.transport = new StreamableHTTPClientTransport(options.url, {
			requestInit: options.requestInit,
			authProvider: options.authProvider,
			fetch: options.fetch,
		});
		this.client = new Client(options.clientInfo, { capabilities: options.capabilities ?? {} });
		this.registerInteractionHandlers();
	}

	async connect(): Promise<void> {
		await this.client.connect(this.transport, { timeout: this.options.timeout });
	}

	getServerVersion(): { name: string; version: string } | undefined {
		return this.client.getServerVersion();
	}

	getProtocolVersion(): string | undefined {
		return this.transport.protocolVersion;
	}

	getServerCapabilities(): McpCapabilities | undefined {
		return this.client.getServerCapabilities() as McpCapabilities | undefined;
	}

	async listTools(cursor?: string): Promise<unknown> {
		return this.client.listTools(cursor ? { cursor } : undefined);
	}

	async callTool(name: string, args?: McpJsonObject): Promise<unknown> {
		return this.client.callTool({ name, arguments: args });
	}

	async listResources(cursor?: string): Promise<unknown> {
		return this.client.listResources(cursor ? { cursor } : undefined);
	}

	async readResource(uri: string): Promise<unknown> {
		return this.client.readResource({ uri });
	}

	async listPrompts(cursor?: string): Promise<unknown> {
		return this.client.listPrompts(cursor ? { cursor } : undefined);
	}

	async getPrompt(name: string, args?: Record<string, string>): Promise<unknown> {
		return this.client.getPrompt({ name, arguments: args });
	}

	async close(): Promise<void> {
		await this.client.close();
	}

	private registerInteractionHandlers(): void {
		const handlers = this.options.interactionHandlers;
		const sampling = handlers?.sampling;
		if (sampling) {
			this.client.setRequestHandler(CreateMessageRequestSchema, async (request) =>
				sampling(request.params as unknown as McpSamplingCreateMessageParams, {
					serverName: this.options.serverName,
					method: "sampling/createMessage",
					round: 1,
				}),
			);
		}
		const elicitation = handlers?.elicitation;
		if (elicitation) {
			this.client.setRequestHandler(ElicitRequestSchema, async (request) =>
				elicitation(request.params as unknown as McpElicitationCreateParams, {
					serverName: this.options.serverName,
					method: "elicitation/create",
					round: 1,
				}),
			);
		}
		const roots = handlers?.roots;
		if (roots) {
			this.client.setRequestHandler(ListRootsRequestSchema, async (request) =>
				roots((request.params ?? {}) as McpJsonObject, {
					serverName: this.options.serverName,
					method: "roots/list",
					round: 1,
				}),
			);
		}
	}
}
