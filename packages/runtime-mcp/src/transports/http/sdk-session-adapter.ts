import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpCapabilities, McpClientInfo, McpJsonObject } from "../../protocol/index.js";

export interface McpHttpSdkSessionOptions {
	readonly url: URL;
	readonly requestInit?: RequestInit;
	readonly fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
	readonly authProvider?: OAuthClientProvider;
	readonly clientInfo: McpClientInfo;
	readonly capabilities?: { roots?: { listChanged?: boolean }; sampling?: object };
	readonly timeout: number;
}

export interface McpHttpSdkSession {
	connect(): Promise<void>;
	getServerVersion(): { name: string; version: string } | undefined;
	getServerCapabilities(): McpCapabilities | undefined;
	listTools(cursor?: string): Promise<unknown>;
	callTool(name: string, args?: McpJsonObject): Promise<unknown>;
	listResources(cursor?: string): Promise<unknown>;
	readResource(uri: string): Promise<unknown>;
	listPrompts(cursor?: string): Promise<unknown>;
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
	}

	async connect(): Promise<void> {
		await this.client.connect(this.transport, { timeout: this.options.timeout });
	}

	getServerVersion(): { name: string; version: string } | undefined {
		return this.client.getServerVersion();
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

	async close(): Promise<void> {
		await this.client.close();
	}
}
