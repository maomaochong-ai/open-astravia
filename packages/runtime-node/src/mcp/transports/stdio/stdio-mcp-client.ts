import type { McpClientHandle } from "../../client/client-handle.js";
import type {
	JsonRpcNotification,
	JsonRpcRequest,
	JsonRpcResponse,
	McpInitializeParams,
	McpInitializeResult,
	McpJsonObject,
	McpPromptsListResult,
	McpResourceReadParams,
	McpResourceReadResult,
	McpResourcesListResult,
	McpStdioServerConfig,
	McpToolCallParams,
	McpToolCallResult,
	McpToolsListResult,
} from "../../protocol/index.js";
import { StdioMcpProcess } from "./stdio-process.js";

const DEFAULT_TIMEOUT_MS = 30000;

export interface StdioMcpClientOptions {
	readonly config: McpStdioServerConfig;
	readonly name: string;
	readonly debug?: boolean;
	readonly timeout?: number;
}

/** MCP JSON-RPC client over the Node stdio process adapter. */
export class StdioMcpClient implements McpClientHandle {
	private readonly process: StdioMcpProcess;
	private readonly name: string;
	private readonly debug: boolean;
	private readonly timeout: number;
	private nextId = 1;
	private readonly pendingRequests = new Map<number | string, PendingRequest>();
	private initialized = false;

	constructor(options: StdioMcpClientOptions) {
		this.name = options.name;
		this.debug = options.debug || options.config.debug || false;
		this.timeout = options.timeout || DEFAULT_TIMEOUT_MS;
		this.process = new StdioMcpProcess({ config: options.config, name: options.name, debug: this.debug });
		this.process.on("message", (message) => this.handleMessage(message));
		this.process.on("error", (error) => this.handleProcessError(error));
		this.process.on("exit", (code, signal) => this.handleProcessExit(code, signal));
	}

	async initialize(params: McpInitializeParams): Promise<McpInitializeResult> {
		await this.process.start();
		const result = await this.request<McpInitializeResult>("initialize", params);
		this.notify("notifications/initialized", {});
		this.initialized = true;
		return result;
	}

	async listTools(cursor?: string): Promise<McpToolsListResult> {
		this.ensureInitialized();
		return this.request<McpToolsListResult>("tools/list", cursor ? { cursor } : undefined);
	}

	async callTool(name: string, args?: McpJsonObject): Promise<McpToolCallResult> {
		this.ensureInitialized();
		const params: McpToolCallParams = { name, arguments: args };
		return this.request<McpToolCallResult>("tools/call", params);
	}

	async listResources(cursor?: string): Promise<McpResourcesListResult> {
		this.ensureInitialized();
		return this.request<McpResourcesListResult>("resources/list", cursor ? { cursor } : undefined);
	}

	async readResource(uri: string): Promise<McpResourceReadResult> {
		this.ensureInitialized();
		const params: McpResourceReadParams = { uri };
		return this.request<McpResourceReadResult>("resources/read", params);
	}

	async listPrompts(cursor?: string): Promise<McpPromptsListResult> {
		this.ensureInitialized();
		return this.request<McpPromptsListResult>("prompts/list", cursor ? { cursor } : undefined);
	}

	async close(): Promise<void> {
		this.rejectPending(new Error("Connection closed"));
		await this.process.stop();
		this.initialized = false;
	}

	getName(): string {
		return this.name;
	}

	getPid(): number | undefined {
		return this.process.getPid();
	}

	isClientInitialized(): boolean {
		return this.initialized;
	}

	private async request<T>(method: string, params?: unknown): Promise<T> {
		const id = this.nextId++;
		const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
		return new Promise<T>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`Request timeout: ${method}`));
			}, this.timeout);
			this.pendingRequests.set(id, { resolve: (value) => resolve(value as T), reject, timeout });
			try {
				this.process.send(request);
			} catch (error) {
				this.pendingRequests.delete(id);
				clearTimeout(timeout);
				reject(error);
			}
		});
	}

	private notify(method: string, params?: unknown): void {
		const notification: JsonRpcNotification = { jsonrpc: "2.0", method, params };
		this.process.send(notification);
	}

	private handleMessage(message: unknown): void {
		const incoming = message as Record<string, unknown>;
		if ("result" in incoming || "error" in incoming) {
			this.handleResponse(incoming as unknown as JsonRpcResponse);
		} else if ("method" in incoming && !("id" in incoming)) {
			this.log(`Received notification: ${String(incoming.method)}`);
		} else {
			this.log(`Unknown message type: ${JSON.stringify(incoming)}`);
		}
	}

	private handleResponse(response: JsonRpcResponse): void {
		const pending = this.pendingRequests.get(response.id);
		if (!pending) {
			this.log(`Received response for unknown request ID: ${response.id}`);
			return;
		}
		this.pendingRequests.delete(response.id);
		clearTimeout(pending.timeout);
		if ("error" in response) {
			pending.reject(
				Object.assign(new Error(response.error.message), { code: response.error.code, data: response.error.data }),
			);
		} else {
			pending.resolve(response.result);
		}
	}

	private handleProcessError(error: Error): void {
		this.log(`Process error: ${error.message}`);
		this.rejectPending(error);
	}

	private handleProcessExit(code: number | null, signal: string | null): void {
		this.log(`Process exited: code=${code}, signal=${signal}`);
		this.rejectPending(new Error(`MCP server exited: code=${code}, signal=${signal}`));
		this.initialized = false;
	}

	private rejectPending(error: Error): void {
		for (const pending of this.pendingRequests.values()) {
			pending.reject(error);
			clearTimeout(pending.timeout);
		}
		this.pendingRequests.clear();
	}

	private ensureInitialized(): void {
		if (!this.initialized) throw new Error("MCP client is not initialized");
	}

	private log(message: string): void {
		if (this.debug) console.error(`[MCPClient:${this.name}] ${message}`);
	}
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
}
