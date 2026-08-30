import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { McpClientHandle } from "@vetta/runtime-mcp/client";
import { McpAuthRequiredError, McpInputRequiredError, McpTaskCreatedError } from "@vetta/runtime-mcp/client";
import type {
	JsonRpcRequest,
	JsonRpcResponse,
	McpCancelTaskParams,
	McpCancelTaskResult,
	McpClientCapabilities,
	McpCreateTaskResult,
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
	McpSubscriptionNotification,
	McpSubscriptionsListenResult,
	McpTaskWaitOptions,
	McpToolCallResult,
	McpToolsListResult,
	McpUpdateTaskParams,
	McpUpdateTaskResult,
} from "@vetta/runtime-mcp/protocol";
import {
	isMcpDiscoverResult,
	isMcpPromptGetResult,
	isMcpPromptsListResult,
	isMcpResourceReadResult,
	isMcpResourcesListResult,
	isMcpSubscriptionsListenResult,
	isMcpTask,
	isMcpTaskTerminal,
	isMcpToolCallResult,
	isMcpToolsListResult,
	MCP_SUBSCRIPTION_ID_META_KEY,
	resolveMcpInputRequests,
} from "@vetta/runtime-mcp/protocol";
import { runMcpMrtrRequest } from "../../interaction/mrtr-request-coordinator.js";
import { CacheableMcpResultStore } from "./cacheable-result-store.js";

const MODERN_PROTOCOL_VERSION = "2026-07-28";
const DEFAULT_TIMEOUT_MS = 30_000;
const JSON_CONTENT_TYPE = "application/json";

export interface ModernStatelessMcpClientOptions {
	readonly config: McpHttpServerConfig;
	readonly name: string;
	readonly clientInfo?: { readonly name: string; readonly version: string };
	readonly clientCapabilities?: McpClientCapabilities;
	readonly debug?: boolean;
	readonly timeout?: number;
	readonly authProvider?: OAuthClientProvider;
	readonly interactionHandlers?: McpServerInteractionHandlers;
	readonly maxInteractionRounds?: number;
	readonly onDiagnostic?: (message: string) => void;
	readonly fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>;
}

/**
 * Modern 2026-07-28 Streamable HTTP client.
 *
 * It intentionally has no protocol Session state. Authentication and the HTTP connection remain
 * transport concerns, while every MCP request carries its own metadata and routing headers.
 */
export class ModernStatelessMcpClient implements McpClientHandle {
	private readonly name: string;
	private readonly config: McpHttpServerConfig;
	private readonly timeout: number;
	private readonly debug: boolean;
	private readonly authProvider?: OAuthClientProvider;
	private readonly interactionHandlers?: McpServerInteractionHandlers;
	private readonly maxInteractionRounds: number;
	private readonly onDiagnostic?: (message: string) => void;
	private readonly fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response>;
	private readonly cache = new CacheableMcpResultStore();
	private clientInfo: ModernStatelessMcpClientOptions["clientInfo"];
	private clientCapabilities: McpClientCapabilities;
	private initialized = false;
	private serverInfo: { name: string; version: string } | undefined;

	constructor(options: ModernStatelessMcpClientOptions) {
		this.name = options.name;
		this.config = options.config;
		this.timeout = options.timeout ?? options.config.startupTimeout ?? DEFAULT_TIMEOUT_MS;
		this.debug = options.debug || options.config.debug || false;
		this.authProvider = options.authProvider;
		this.interactionHandlers = options.interactionHandlers;
		this.maxInteractionRounds = Math.max(1, options.maxInteractionRounds ?? 3);
		this.onDiagnostic = options.onDiagnostic;
		this.fetchImpl = options.fetch ?? fetch;
		this.clientInfo = options.clientInfo;
		this.clientCapabilities = withModernExtensionCapabilities(options.clientCapabilities ?? {});
	}

	async initialize(params: McpInitializeParams): Promise<McpInitializeResult> {
		this.clientInfo = params.clientInfo;
		this.clientCapabilities = withModernExtensionCapabilities(
			mergeLegacyCapabilities(params, this.clientCapabilities),
		);
		const result = await this.requestCacheable("server/discover", {});
		if (!isMcpDiscoverResult(result, { era: "modern" })) {
			this.log("invalid modern server/discover result");
			throw new Error("Invalid MCP server/discover result");
		}
		this.serverInfo = readServerInfo(result);
		this.initialized = true;
		this.log(`connected protocol=${MODERN_PROTOCOL_VERSION} mode=stateless`);
		return {
			protocolVersion: MODERN_PROTOCOL_VERSION,
			serverInfo: {
				name: this.serverInfo?.name ?? this.name,
				version: this.serverInfo?.version ?? "unknown",
				capabilities: result.capabilities,
			},
			capabilities: result.capabilities,
		};
	}

	async listTools(cursor?: string, options?: McpRequestOptions): Promise<McpToolsListResult> {
		this.ensureInitialized();
		const result = await this.requestCacheable("tools/list", cursor ? { cursor } : {}, options);
		if (!isMcpToolsListResult(result, { era: "modern" })) throw this.invalidResult("tools/list");
		return result;
	}

	async callTool(name: string, args?: McpJsonObject, options?: McpRequestOptions): Promise<McpToolCallResult> {
		this.ensureInitialized();
		return runMcpMrtrRequest({
			serverName: this.name,
			method: "tools/call",
			initialFields: { name, arguments: args ?? {} },
			requestOptions: options,
			handlers: this.interactionHandlers,
			maxRounds: this.maxInteractionRounds,
			invoke: async (fields, signal) => {
				const result = await this.request("tools/call", fields, { ...options, signal });
				if (isTaskResult(result)) throw new McpTaskCreatedError("tools/call", result);
				return result;
			},
			accept: (value): value is McpToolCallResult => isMcpToolCallResult(value, { era: "modern" }),
			invalidResult: () => this.invalidResult("tools/call"),
			onRound: (round) => this.log(`input required method=tools/call round=${round}`),
		});
	}

	async listResources(cursor?: string, options?: McpRequestOptions): Promise<McpResourcesListResult> {
		this.ensureInitialized();
		const result = await this.requestCacheable("resources/list", cursor ? { cursor } : {}, options);
		if (!isMcpResourcesListResult(result, { era: "modern" })) throw this.invalidResult("resources/list");
		return result;
	}

	async readResource(uri: string, options?: McpRequestOptions): Promise<McpResourceReadResult> {
		this.ensureInitialized();
		return runMcpMrtrRequest({
			serverName: this.name,
			method: "resources/read",
			initialFields: { uri },
			requestOptions: options,
			handlers: this.interactionHandlers,
			maxRounds: this.maxInteractionRounds,
			invoke: (fields, signal) => this.requestCacheable("resources/read", fields, { ...options, signal }),
			accept: (value): value is McpResourceReadResult => isMcpResourceReadResult(value, { era: "modern" }),
			invalidResult: () => this.invalidResult("resources/read"),
			onRound: (round) => this.log(`input required method=resources/read round=${round}`),
		});
	}

	async listPrompts(cursor?: string, options?: McpRequestOptions): Promise<McpPromptsListResult> {
		this.ensureInitialized();
		const result = await this.requestCacheable("prompts/list", cursor ? { cursor } : {}, options);
		if (!isMcpPromptsListResult(result, { era: "modern" })) throw this.invalidResult("prompts/list");
		return result;
	}

	async getPrompt(params: McpPromptGetParams, options?: McpRequestOptions): Promise<McpPromptGetResult> {
		this.ensureInitialized();
		return runMcpMrtrRequest({
			serverName: this.name,
			method: "prompts/get",
			initialFields: { name: params.name, arguments: params.arguments ?? {} },
			requestOptions: options,
			handlers: this.interactionHandlers,
			maxRounds: this.maxInteractionRounds,
			invoke: (fields, signal) => this.request("prompts/get", fields, { ...options, signal }),
			accept: (value): value is McpPromptGetResult => isMcpPromptGetResult(value, { era: "modern" }),
			invalidResult: () => this.invalidResult("prompts/get"),
			onRound: (round) => this.log(`input required method=prompts/get round=${round}`),
		});
	}

	async getTask(params: McpGetTaskParams, options?: McpRequestOptions): Promise<McpGetTaskResult> {
		this.ensureInitialized();
		const result = await this.request("tasks/get", { ...params }, options);
		if (!isMcpTask(result) || !isRecord(result) || result.resultType !== "complete")
			throw this.invalidResult("tasks/get");
		return result as unknown as McpGetTaskResult;
	}

	async updateTask(params: McpUpdateTaskParams, options?: McpRequestOptions): Promise<McpUpdateTaskResult> {
		this.ensureInitialized();
		const result = await this.request("tasks/update", { ...params }, options);
		if (!isEmptyCompleteResult(result)) throw this.invalidResult("tasks/update");
		return result;
	}

	async cancelTask(params: McpCancelTaskParams, options?: McpRequestOptions): Promise<McpCancelTaskResult> {
		this.ensureInitialized();
		const result = await this.request("tasks/cancel", { ...params }, options);
		if (!isEmptyCompleteResult(result)) throw this.invalidResult("tasks/cancel");
		return result;
	}

	async waitForTask(params: McpGetTaskParams, options: McpTaskWaitOptions = {}): Promise<McpGetTaskResult> {
		const deadline = Date.now() + (options.timeoutMs ?? 5 * 60_000);
		const answeredRevisions = new Set<string>();
		let task = await this.getTask(params, { signal: options.signal });
		while (!isMcpTaskTerminal(task.status)) {
			await options.onStatus?.(task);
			if (options.signal?.aborted) throw new DOMException("Task wait aborted", "AbortError");
			if (task.status === "input_required" && !answeredRevisions.has(task.lastUpdatedAt)) {
				if (!this.interactionHandlers) {
					throw new McpInputRequiredError("tasks/update", {
						resultType: "input_required",
						inputRequests: task.inputRequests,
					});
				}
				const inputResponses = await resolveMcpInputRequests(task.inputRequests, this.interactionHandlers, {
					serverName: this.name,
					method: "tasks/update",
					round: 1,
					signal: options.signal,
				});
				await this.updateTask({ taskId: params.taskId, inputResponses }, { signal: options.signal });
				answeredRevisions.add(task.lastUpdatedAt);
			}
			const delay = Math.min(task.pollIntervalMs ?? 1000, Math.max(0, deadline - Date.now()));
			if (Date.now() >= deadline) throw new Error(`MCP task wait timeout: ${params.taskId}`);
			await delayWithSignal(delay, options.signal);
			task = await this.getTask(params, { signal: options.signal });
		}
		await options.onStatus?.(task);
		return task;
	}

	async listenSubscriptions(
		filter: McpSubscriptionFilter,
		onNotification: McpSubscriptionHandler,
		options?: McpRequestOptions,
	): Promise<McpSubscriptionsListenResult> {
		this.ensureInitialized();
		const method = "subscriptions/listen";
		const fields: McpJsonObject = { notifications: normalizeSubscriptionFilter(filter) };
		const id = crypto.randomUUID();
		const request: JsonRpcRequest = {
			jsonrpc: "2.0",
			id,
			method,
			params: { ...fields, _meta: this.requestMeta() },
		};
		const response = await this.fetchImpl(this.config.url, {
			method: "POST",
			headers: await this.buildHeaders(method, fields),
			body: JSON.stringify(request),
			signal: options?.signal,
		});
		if (response.status === 401 || response.status === 403) {
			throw new McpAuthRequiredError(this.name, this.config.url, `MCP server returned HTTP ${response.status}`);
		}
		if (!response.ok) throw toRpcError(response.status, await readResponsePayload(response));

		let acknowledged = false;
		for await (const message of readSubscriptionMessages(response)) {
			if (isSubscriptionNotification(message, id)) {
				if (!acknowledged && message.method !== "notifications/subscriptions/acknowledged") {
					throw new Error("MCP subscription notification arrived before acknowledgement");
				}
				if (message.method === "notifications/subscriptions/acknowledged") acknowledged = true;
				await onNotification(message);
				continue;
			}
			if (!isRpcResponse(message) || message.id !== id) continue;
			if ("error" in message) throw Object.assign(new Error(message.error.message), message.error);
			if (!acknowledged) throw new Error("MCP subscription ended before acknowledgement");
			if (!isMcpSubscriptionsListenResult(message.result)) throw this.invalidResult(method);
			return message.result;
		}
		throw new Error("MCP subscription stream closed without a final response");
	}

	async close(): Promise<void> {
		this.initialized = false;
		this.serverInfo = undefined;
		this.cache.clear();
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

	private async requestCacheable(
		method: string,
		fields: McpJsonObject,
		options?: McpRequestOptions,
	): Promise<unknown> {
		const headers = await this.buildHeaders(method, fields);
		if (!options?.forceRefresh) {
			const cached = this.cache.get(method, fields, headers);
			if (cached) {
				this.log(`cache hit method=${method} scope=${cached.cacheScope}`);
				return cached;
			}
		}
		const result = await this.request(method, fields, options, headers);
		this.cache.set(method, fields, headers, result);
		return result;
	}

	private async request(
		method: string,
		fields: McpJsonObject,
		options?: McpRequestOptions,
		preparedHeaders?: Record<string, string>,
	): Promise<unknown> {
		const request: JsonRpcRequest = {
			jsonrpc: "2.0",
			id: crypto.randomUUID(),
			method,
			params: { ...fields, _meta: this.requestMeta() },
		};
		const headers = preparedHeaders ?? (await this.buildHeaders(method, fields));
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.timeout);
		const signal = combineAbortSignals(controller.signal, options?.signal);
		const startedAt = Date.now();
		try {
			const response = await this.fetchImpl(this.config.url, {
				method: "POST",
				headers,
				body: JSON.stringify(request),
				signal,
			});
			if (response.status === 401 || response.status === 403) {
				throw new McpAuthRequiredError(this.name, this.config.url, `MCP server returned HTTP ${response.status}`);
			}
			const payload = await readResponsePayload(response);
			if (!response.ok) throw toRpcError(response.status, payload);
			if (!isRpcResponse(payload)) throw new Error("Invalid MCP JSON-RPC response");
			if ("error" in payload) {
				this.log(`request failed method=${method} code=${payload.error.code}`);
				throw Object.assign(new Error(payload.error.message), {
					code: payload.error.code,
					data: payload.error.data,
				});
			}
			this.log(`request completed method=${method} durationMs=${Date.now() - startedAt}`);
			return payload.result;
		} catch (error) {
			if (isAbortError(error)) {
				this.log(
					options?.signal?.aborted ? `request cancelled method=${method}` : `request timeout method=${method}`,
				);
			}
			throw error;
		} finally {
			clearTimeout(timeout);
		}
	}

	private async buildHeaders(method: string, fields: McpJsonObject): Promise<Record<string, string>> {
		const headers: Record<string, string> = {};
		for (const [key, value] of Object.entries(this.config.headers ?? {})) headers[key] = String(value);
		if (this.config.resolveHeaders) {
			try {
				for (const [key, value] of Object.entries(await this.config.resolveHeaders())) headers[key] = String(value);
			} catch {
				this.log("dynamic auth headers unavailable");
			}
		}
		const tokens = await this.authProvider?.tokens();
		if (tokens?.access_token && !headers.Authorization && !headers.authorization) {
			headers.Authorization = `Bearer ${tokens.access_token}`;
		}
		headers["Content-Type"] = JSON_CONTENT_TYPE;
		headers.Accept = `${JSON_CONTENT_TYPE}, text/event-stream`;
		headers["MCP-Protocol-Version"] = MODERN_PROTOCOL_VERSION;
		headers["Mcp-Method"] = method;
		const name = getRoutableName(method, fields);
		if (name !== undefined) headers["Mcp-Name"] = encodeHeaderValue(name);
		return headers;
	}

	private requestMeta(): McpJsonObject {
		return {
			"io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
			...(this.clientInfo ? { "io.modelcontextprotocol/clientInfo": this.clientInfo } : {}),
			"io.modelcontextprotocol/clientCapabilities": this.clientCapabilities,
		};
	}

	private ensureInitialized(): void {
		if (!this.initialized) throw new Error("Modern MCP client is not initialized");
	}

	private invalidResult(method: string): Error {
		this.log(`invalid result method=${method}`);
		return new Error(`Invalid MCP ${method} result`);
	}

	private log(message: string): void {
		const formatted = `[MCPClient:${this.name}] ${message}`;
		if (this.onDiagnostic) this.onDiagnostic(formatted);
		else if (this.debug) console.error(formatted);
	}
}

function mergeLegacyCapabilities(params: McpInitializeParams, existing: McpClientCapabilities): McpClientCapabilities {
	return {
		...existing,
		roots: params.capabilities?.roots ? {} : existing.roots,
		sampling: params.capabilities?.sampling ? {} : existing.sampling,
		elicitation: params.capabilities?.elicitation ?? existing.elicitation,
		extensions: params.capabilities?.extensions ?? existing.extensions,
	};
}

function getRoutableName(method: string, fields: McpJsonObject): string | undefined {
	if (method === "tools/call" || method === "prompts/get")
		return typeof fields.name === "string" ? fields.name : undefined;
	if (method === "resources/read") return typeof fields.uri === "string" ? fields.uri : undefined;
	if (method === "tasks/get" || method === "tasks/update" || method === "tasks/cancel")
		return typeof fields.taskId === "string" ? fields.taskId : undefined;
	return undefined;
}

function encodeHeaderValue(value: string): string {
	const safe = /^[\x20-\x7e\t]*$/.test(value) && value === value.trim() && !/^=?base64\?/.test(value);
	if (safe) return value;
	return `=?base64?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

async function readResponsePayload(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text.trim()) return undefined;
	if (response.headers.get("content-type")?.includes("text/event-stream")) {
		const data = text
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.join("\n");
		return JSON.parse(data);
	}
	return JSON.parse(text);
}

function isRpcResponse(value: unknown): value is JsonRpcResponse {
	return isRecord(value) && value.jsonrpc === "2.0" && ("result" in value || "error" in value);
}

function isTaskResult(value: unknown): value is McpCreateTaskResult {
	return (
		isRecord(value) &&
		value.resultType === "task" &&
		typeof value.taskId === "string" &&
		typeof value.status === "string"
	);
}

function isEmptyCompleteResult(value: unknown): value is McpUpdateTaskResult {
	return isRecord(value) && value.resultType === "complete";
}

function readServerInfo(result: {
	readonly _meta?: Record<string, unknown>;
}): { name: string; version: string } | undefined {
	const value = result._meta?.["io.modelcontextprotocol/serverInfo"];
	if (!isRecord(value) || typeof value.name !== "string" || typeof value.version !== "string") return undefined;
	return { name: value.name, version: value.version };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRpcError(status: number, payload: unknown): Error {
	if (isRpcResponse(payload) && "error" in payload) {
		return Object.assign(new Error(payload.error.message), { code: payload.error.code, data: payload.error.data });
	}
	return new Error(`MCP HTTP ${status}`);
}

async function delayWithSignal(delayMs: number, signal?: AbortSignal): Promise<void> {
	if (delayMs <= 0) return;
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, delayMs);
		const abort = () => {
			clearTimeout(timer);
			reject(new DOMException("Task wait aborted", "AbortError"));
		};
		if (signal?.aborted) return abort();
		signal?.addEventListener("abort", abort, { once: true });
	});
}

function withModernExtensionCapabilities(capabilities: McpClientCapabilities): McpClientCapabilities {
	return {
		...capabilities,
		extensions: {
			...capabilities.extensions,
			"io.modelcontextprotocol/tasks": {},
		},
	};
}

function combineAbortSignals(timeoutSignal: AbortSignal, callerSignal?: AbortSignal): AbortSignal {
	return callerSignal ? AbortSignal.any([timeoutSignal, callerSignal]) : timeoutSignal;
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

function normalizeSubscriptionFilter(filter: McpSubscriptionFilter): McpJsonObject {
	return {
		...(filter.toolsListChanged === undefined ? {} : { toolsListChanged: filter.toolsListChanged }),
		...(filter.promptsListChanged === undefined ? {} : { promptsListChanged: filter.promptsListChanged }),
		...(filter.resourcesListChanged === undefined ? {} : { resourcesListChanged: filter.resourcesListChanged }),
		...(filter.resourceSubscriptions === undefined ? {} : { resourceSubscriptions: filter.resourceSubscriptions }),
	};
}

async function* readSubscriptionMessages(response: Response): AsyncGenerator<unknown> {
	if (!response.headers.get("content-type")?.includes("text/event-stream")) {
		yield await readResponsePayload(response);
		return;
	}
	if (!response.body) return;
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			buffer += decoder.decode(value, { stream: !done });
			const events = buffer.split(/\r?\n\r?\n/);
			buffer = events.pop() ?? "";
			for (const event of events) {
				const data = event
					.split(/\r?\n/)
					.filter((line) => line.startsWith("data:"))
					.map((line) => line.slice(5).trimStart())
					.join("\n");
				if (data) yield JSON.parse(data);
			}
			if (done) break;
		}
		if (buffer.trim()) {
			const data = buffer
				.split(/\r?\n/)
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trimStart())
				.join("\n");
			if (data) yield JSON.parse(data);
		}
	} finally {
		reader.releaseLock();
	}
}

function isSubscriptionNotification(value: unknown, id: string | number): value is McpSubscriptionNotification {
	if (!isRecord(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string" || !("params" in value))
		return false;
	if (!isRecord(value.params) || !isRecord(value.params._meta)) return false;
	return value.params._meta[MCP_SUBSCRIPTION_ID_META_KEY] === id;
}
