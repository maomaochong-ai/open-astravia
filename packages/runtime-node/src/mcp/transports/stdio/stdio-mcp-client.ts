import { McpTaskCreatedError } from "../../client/client-errors.js";
import type { McpClientHandle } from "../../client/client-handle.js";
import { runMcpMrtrRequest } from "../../interaction/mrtr-request-coordinator.js";
import type {
	JsonRpcErrorResponse,
	JsonRpcNotification,
	JsonRpcRequest,
	JsonRpcResponse,
	McpCancelTaskParams,
	McpCancelTaskResult,
	McpCreateTaskResult,
	McpGetTaskParams,
	McpGetTaskResult,
	McpInitializeParams,
	McpInitializeResult,
	McpJsonObject,
	McpPromptGetParams,
	McpPromptGetResult,
	McpPromptsListResult,
	McpRequestOptions,
	McpResourceReadParams,
	McpResourceReadResult,
	McpResourcesListResult,
	McpServerInteractionHandlers,
	McpStdioServerConfig,
	McpSubscriptionFilter,
	McpSubscriptionHandler,
	McpSubscriptionsListenResult,
	McpTaskWaitOptions,
	McpToolCallParams,
	McpToolCallResult,
	McpToolsListResult,
	McpUpdateTaskParams,
	McpUpdateTaskResult,
} from "../../protocol/index.js";
import {
	isMcpDiscoverResult,
	isMcpInitializeResult,
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
	McpInteractionInvalidRequestError,
	McpInteractionUnsupportedError,
	resolveMcpInputRequests,
} from "../../protocol/index.js";
import { StdioMcpProcess } from "./stdio-process.js";

const DEFAULT_TIMEOUT_MS = 30000;

export interface StdioMcpClientOptions {
	readonly config: McpStdioServerConfig;
	readonly name: string;
	readonly debug?: boolean;
	readonly timeout?: number;
	readonly interactionHandlers?: McpServerInteractionHandlers;
	readonly maxInteractionRounds?: number;
	readonly onDiagnostic?: (message: string) => void;
}

/** MCP JSON-RPC client over the Node stdio process adapter. */
export class StdioMcpClient implements McpClientHandle {
	private readonly process: StdioMcpProcess;
	private readonly config: McpStdioServerConfig;
	private readonly name: string;
	private readonly debug: boolean;
	private readonly timeout: number;
	private readonly onDiagnostic?: (message: string) => void;
	private readonly interactionHandlers?: McpServerInteractionHandlers;
	private readonly maxInteractionRounds: number;
	private clientInfo: McpInitializeParams["clientInfo"] | undefined;
	private clientCapabilities: Record<string, unknown> = {};
	private nextId = 1;
	private readonly pendingRequests = new Map<number | string, PendingRequest>();
	private readonly subscriptions = new Map<number | string, ActiveSubscription>();
	private initialized = false;
	private resolvedEra: "legacy" | "modern" | undefined;

	constructor(options: StdioMcpClientOptions) {
		this.config = options.config;
		this.name = options.name;
		this.debug = options.debug || options.config.debug || false;
		this.timeout = options.timeout || DEFAULT_TIMEOUT_MS;
		this.onDiagnostic = options.onDiagnostic;
		this.interactionHandlers = options.interactionHandlers;
		this.maxInteractionRounds = Math.max(1, options.maxInteractionRounds ?? 3);
		this.process = new StdioMcpProcess({ config: options.config, name: options.name, debug: this.debug });
		this.process.on("message", (message) => this.handleMessage(message));
		this.process.on("error", (error) => this.handleProcessError(error));
		this.process.on("exit", (code, signal) => this.handleProcessExit(code, signal));
	}

	async initialize(params: McpInitializeParams): Promise<McpInitializeResult> {
		await this.process.start();
		this.clientInfo = params.clientInfo;
		const mode = this.config.protocolMode ?? "legacy";
		if (mode === "modern" || mode === "auto") {
			this.clientCapabilities = {
				...(params.capabilities?.roots ? { roots: {} } : {}),
				...(params.capabilities?.sampling ? { sampling: {} } : {}),
				...(params.capabilities?.elicitation ? { elicitation: params.capabilities.elicitation } : {}),
				extensions: {
					...params.capabilities?.extensions,
					"io.modelcontextprotocol/tasks": {},
				},
			};
			try {
				const discovery = await this.request<unknown>("server/discover", this.modernParams({}));
				if (!isMcpDiscoverResult(discovery, { era: "modern" }))
					throw new Error("Invalid MCP server/discover result");
				this.resolvedEra = "modern";
				this.initialized = true;
				const serverInfo = readServerInfo(discovery);
				this.log("connected protocol=2026-07-28 mode=stdio-modern");
				return {
					protocolVersion: "2026-07-28",
					serverInfo: {
						name: serverInfo?.name ?? this.name,
						version: serverInfo?.version ?? "unknown",
						capabilities: discovery.capabilities,
					},
					capabilities: discovery.capabilities,
				};
			} catch (error) {
				if (mode === "modern") throw error;
				this.log("modern discovery unavailable; fallback=legacy");
			}
		}
		const result = assertResult(
			"initialize",
			await this.request<unknown>("initialize", params),
			isMcpInitializeResult,
			(message) => this.log(message),
		);
		this.notify("notifications/initialized", {});
		this.resolvedEra = "legacy";
		this.initialized = true;
		this.log(`initialized with protocol ${result.protocolVersion}`);
		return result;
	}

	async listTools(cursor?: string, options?: McpRequestOptions): Promise<McpToolsListResult> {
		this.ensureInitialized();
		const result = await this.request<unknown>("tools/list", this.prepareParams(cursor ? { cursor } : {}), options);
		return assertResult("tools/list", result, (value): value is McpToolsListResult =>
			isMcpToolsListResult(value, { era: this.resolvedEra }),
		);
	}

	async callTool(name: string, args?: McpJsonObject, options?: McpRequestOptions): Promise<McpToolCallResult> {
		this.ensureInitialized();
		const params: McpToolCallParams = { name, arguments: args };
		if (this.resolvedEra === "modern") {
			return runMcpMrtrRequest({
				serverName: this.name,
				method: "tools/call",
				initialFields: { name, arguments: args ?? {} },
				requestOptions: options,
				handlers: this.interactionHandlers,
				maxRounds: this.maxInteractionRounds,
				invoke: async (fields, signal) => {
					const result = await this.request<unknown>("tools/call", this.prepareParams(fields), {
						...options,
						signal,
					});
					if (isTaskResult(result)) throw new McpTaskCreatedError("tools/call", result);
					return result;
				},
				accept: (value): value is McpToolCallResult => isMcpToolCallResult(value, { era: "modern" }),
				invalidResult: () => new Error("Invalid MCP tools/call result"),
				onRound: (round) => this.log(`input required method=tools/call round=${round}`),
			});
		}
		return assertResult(
			"tools/call",
			await this.request<unknown>("tools/call", params, options),
			isMcpToolCallResult,
			(message) => this.log(message),
		);
	}

	async listResources(cursor?: string, options?: McpRequestOptions): Promise<McpResourcesListResult> {
		this.ensureInitialized();
		const result = await this.request<unknown>(
			"resources/list",
			this.prepareParams(cursor ? { cursor } : {}),
			options,
		);
		return assertResult("resources/list", result, (value): value is McpResourcesListResult =>
			isMcpResourcesListResult(value, { era: this.resolvedEra }),
		);
	}

	async readResource(uri: string, options?: McpRequestOptions): Promise<McpResourceReadResult> {
		this.ensureInitialized();
		const params: McpResourceReadParams = { uri };
		if (this.resolvedEra === "modern") {
			return runMcpMrtrRequest({
				serverName: this.name,
				method: "resources/read",
				initialFields: { uri },
				requestOptions: options,
				handlers: this.interactionHandlers,
				maxRounds: this.maxInteractionRounds,
				invoke: (fields, signal) =>
					this.request<unknown>("resources/read", this.prepareParams(fields), { ...options, signal }),
				accept: (value): value is McpResourceReadResult => isMcpResourceReadResult(value, { era: "modern" }),
				invalidResult: () => new Error("Invalid MCP resources/read result"),
				onRound: (round) => this.log(`input required method=resources/read round=${round}`),
			});
		}
		return assertResult(
			"resources/read",
			await this.request<unknown>("resources/read", params, options),
			isMcpResourceReadResult,
			(message) => this.log(message),
		);
	}

	async listPrompts(cursor?: string, options?: McpRequestOptions): Promise<McpPromptsListResult> {
		this.ensureInitialized();
		const result = await this.request<unknown>("prompts/list", this.prepareParams(cursor ? { cursor } : {}), options);
		return assertResult("prompts/list", result, (value): value is McpPromptsListResult =>
			isMcpPromptsListResult(value, { era: this.resolvedEra }),
		);
	}

	async getPrompt(params: McpPromptGetParams, options?: McpRequestOptions): Promise<McpPromptGetResult> {
		this.ensureInitialized();
		const fields: McpJsonObject = { name: params.name, arguments: params.arguments ?? {} };
		if (this.resolvedEra === "modern") {
			return runMcpMrtrRequest({
				serverName: this.name,
				method: "prompts/get",
				initialFields: fields,
				requestOptions: options,
				handlers: this.interactionHandlers,
				maxRounds: this.maxInteractionRounds,
				invoke: (nextFields, signal) =>
					this.request<unknown>("prompts/get", this.prepareParams(nextFields), { ...options, signal }),
				accept: (value): value is McpPromptGetResult => isMcpPromptGetResult(value, { era: "modern" }),
				invalidResult: () => new Error("Invalid MCP prompts/get result"),
				onRound: (round) => this.log(`input required method=prompts/get round=${round}`),
			});
		}
		return assertResult(
			"prompts/get",
			await this.request<unknown>("prompts/get", fields, options),
			isMcpPromptGetResult,
		);
	}

	async getTask(params: McpGetTaskParams, options?: McpRequestOptions): Promise<McpGetTaskResult> {
		this.ensureModernTasks();
		const result = await this.request<unknown>("tasks/get", this.prepareParams({ ...params }), options);
		if (!isMcpTask(result) || !isCompleteResult(result)) throw new Error("Invalid MCP tasks/get result");
		return result as McpGetTaskResult;
	}

	async updateTask(params: McpUpdateTaskParams, options?: McpRequestOptions): Promise<McpUpdateTaskResult> {
		this.ensureModernTasks();
		const result = await this.request<unknown>("tasks/update", this.prepareParams({ ...params }), options);
		if (!isCompleteResult(result)) throw new Error("Invalid MCP tasks/update result");
		return result;
	}

	async cancelTask(params: McpCancelTaskParams, options?: McpRequestOptions): Promise<McpCancelTaskResult> {
		this.ensureModernTasks();
		const result = await this.request<unknown>("tasks/cancel", this.prepareParams({ ...params }), options);
		if (!isCompleteResult(result)) throw new Error("Invalid MCP tasks/cancel result");
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
				if (!this.interactionHandlers) throw new Error("MCP task input requires interaction handlers");
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
		if (this.resolvedEra !== "modern") throw new Error("MCP subscriptions require the 2026-07-28 protocol");
		let subscriptionId: string | number | undefined;
		try {
			const result = await this.request<unknown>(
				"subscriptions/listen",
				this.prepareParams({ notifications: normalizeSubscriptionFilter(filter) }),
				options,
				(id) => {
					subscriptionId = id;
					this.subscriptions.set(id, { acknowledged: false, onNotification });
				},
				null,
			);
			if (!isMcpSubscriptionsListenResult(result)) throw new Error("Invalid MCP subscriptions/listen result");
			if (result._meta[MCP_SUBSCRIPTION_ID_META_KEY] !== subscriptionId) {
				throw new Error("MCP subscription result ID mismatch");
			}
			return result;
		} finally {
			if (subscriptionId !== undefined) this.subscriptions.delete(subscriptionId);
		}
	}

	async close(): Promise<void> {
		this.rejectPending(new Error("Connection closed"));
		await this.process.stop();
		this.initialized = false;
		this.resolvedEra = undefined;
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

	private async request<T>(
		method: string,
		params?: unknown,
		options?: McpRequestOptions,
		onCreated?: (id: string | number) => void,
		timeoutMs: number | null = this.timeout,
	): Promise<T> {
		const id = this.nextId++;
		const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
		return new Promise<T>((resolve, reject) => {
			const abort = () => {
				const pending = this.pendingRequests.get(id);
				if (!pending) return;
				this.pendingRequests.delete(id);
				if (pending.timeout) clearTimeout(pending.timeout);
				pending.abortSignal?.removeEventListener("abort", abort);
				this.notifyCancellation(id, method, "Request cancelled by host");
				reject(options?.signal?.reason ?? new DOMException("MCP request aborted", "AbortError"));
			};
			if (options?.signal?.aborted) {
				reject(options.signal.reason ?? new DOMException("MCP request aborted", "AbortError"));
				return;
			}
			const timeout =
				timeoutMs === null
					? undefined
					: setTimeout(() => {
							this.pendingRequests.delete(id);
							options?.signal?.removeEventListener("abort", abort);
							this.notifyCancellation(id, method, "Request timed out");
							this.log(`request timeout method=${method}`);
							reject(new Error(`Request timeout: ${method}`));
						}, timeoutMs);
			this.pendingRequests.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
				timeout,
				method,
				abortSignal: options?.signal,
				abort,
			});
			onCreated?.(id);
			options?.signal?.addEventListener("abort", abort, { once: true });
			try {
				this.process.send(request);
			} catch (error) {
				this.pendingRequests.delete(id);
				if (timeout) clearTimeout(timeout);
				options?.signal?.removeEventListener("abort", abort);
				reject(error);
			}
		});
	}

	private notify(method: string, params?: unknown): void {
		const notification: JsonRpcNotification = { jsonrpc: "2.0", method, params };
		this.process.send(notification);
	}

	private notifyCancellation(requestId: string | number, method: string, reason: string): void {
		try {
			this.notify("notifications/cancelled", { requestId, reason });
			this.log(`request cancelled method=${method}`);
		} catch (error) {
			this.log(`cancellation notification failed method=${method} error=${getErrorName(error)}`);
		}
	}

	private handleMessage(message: unknown): void {
		if (message === null || typeof message !== "object" || Array.isArray(message)) {
			this.log("Unknown JSON-RPC message shape");
			return;
		}
		const incoming = message as Record<string, unknown>;
		if ("result" in incoming || "error" in incoming) {
			this.handleResponse(incoming as unknown as JsonRpcResponse);
		} else if ("method" in incoming && !("id" in incoming)) {
			this.handleNotification(incoming);
		} else if ("method" in incoming && "id" in incoming) {
			void this.handleServerRequest(incoming);
		} else {
			this.log("Unknown JSON-RPC message shape");
		}
	}

	private handleNotification(notification: Record<string, unknown>): void {
		const method = String(notification.method);
		const params = isRecord(notification.params) ? notification.params : undefined;
		const meta = params && isRecord(params._meta) ? params._meta : undefined;
		const subscriptionId = meta?.[MCP_SUBSCRIPTION_ID_META_KEY];
		if (typeof subscriptionId !== "string" && typeof subscriptionId !== "number") {
			this.log(`Received notification: ${method}`);
			return;
		}
		const subscription = this.subscriptions.get(subscriptionId);
		if (!subscription) {
			this.log(`subscription notification ignored method=${method} reason=unknown-id`);
			return;
		}
		if (!subscription.acknowledged && method !== "notifications/subscriptions/acknowledged") {
			this.failPendingSubscription(
				subscriptionId,
				new Error("MCP subscription notification arrived before acknowledgement"),
			);
			return;
		}
		if (method === "notifications/subscriptions/acknowledged") subscription.acknowledged = true;
		Promise.resolve(
			subscription.onNotification(notification as unknown as Parameters<McpSubscriptionHandler>[0]),
		).catch((error) => this.log(`subscription handler failed method=${method} error=${getErrorName(error)}`));
	}

	private failPendingSubscription(id: string | number, error: Error): void {
		const pending = this.pendingRequests.get(id);
		if (!pending) return;
		this.pendingRequests.delete(id);
		this.subscriptions.delete(id);
		if (pending.timeout) clearTimeout(pending.timeout);
		pending.abortSignal?.removeEventListener("abort", pending.abort);
		this.notifyCancellation(id, pending.method, "Invalid subscription stream");
		pending.reject(error);
	}

	private async handleServerRequest(request: Record<string, unknown>): Promise<void> {
		const method = String(request.method);
		const id = request.id as string | number;
		if (this.resolvedEra !== "legacy" || !this.interactionHandlers) {
			this.sendServerRequestError(id, method, -32601, "Server-initiated request is not supported");
			return;
		}
		const params = isRecord(request.params) ? request.params : {};
		try {
			const context = { serverName: this.name, method, round: 1 } as const;
			const responses = await resolveMcpInputRequests(
				{ request: { method, params: params as McpJsonObject } },
				this.interactionHandlers,
				context,
			);
			const result = responses.request;
			this.process.send({ jsonrpc: "2.0", id, result });
			this.log(`server request completed method=${method}`);
		} catch (error) {
			const code =
				error instanceof McpInteractionInvalidRequestError
					? -32602
					: error instanceof McpInteractionUnsupportedError
						? -32601
						: -32603;
			const message =
				error instanceof McpInteractionInvalidRequestError || error instanceof McpInteractionUnsupportedError
					? error.message
					: "Host interaction failed";
			this.sendServerRequestError(id, method, code, message);
			this.log(`server request failed method=${method} error=${getErrorName(error)}`);
		}
	}

	private sendServerRequestError(id: string | number, method: string, code: number, message: string): void {
		this.log(`server request rejected method=${method} code=${code}`);
		const response: JsonRpcErrorResponse = { jsonrpc: "2.0", id, error: { code, message } };
		try {
			this.process.send(response);
		} catch (error) {
			this.log(`server request response failed method=${method} error=${getErrorName(error)}`);
		}
	}

	private handleResponse(response: JsonRpcResponse): void {
		const pending = this.pendingRequests.get(response.id);
		if (!pending) {
			this.log(`Received response for unknown request ID: ${response.id}`);
			return;
		}
		this.pendingRequests.delete(response.id);
		if (pending.timeout) clearTimeout(pending.timeout);
		pending.abortSignal?.removeEventListener("abort", pending.abort);
		if ("error" in response) {
			this.log(`request failed method=${pending.method} code=${response.error.code}`);
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
		this.resolvedEra = undefined;
	}

	private rejectPending(error: Error): void {
		for (const pending of this.pendingRequests.values()) {
			pending.reject(error);
			if (pending.timeout) clearTimeout(pending.timeout);
			pending.abortSignal?.removeEventListener("abort", pending.abort);
		}
		this.pendingRequests.clear();
	}

	private ensureInitialized(): void {
		if (!this.initialized) throw new Error("MCP client is not initialized");
	}

	private prepareParams(params: Record<string, unknown>): Record<string, unknown> {
		return this.resolvedEra === "modern" ? this.modernParams(params) : params;
	}

	private ensureModernTasks(): void {
		this.ensureInitialized();
		if (this.resolvedEra !== "modern") throw new Error("MCP Tasks require the 2026-07-28 protocol");
	}

	private modernParams(params: Record<string, unknown>): Record<string, unknown> {
		return {
			...params,
			_meta: {
				"io.modelcontextprotocol/protocolVersion": "2026-07-28",
				"io.modelcontextprotocol/clientInfo": this.clientInfo,
				"io.modelcontextprotocol/clientCapabilities": this.clientCapabilities,
			},
		};
	}

	private log(message: string): void {
		const formatted = `[MCPClient:${this.name}] ${message}`;
		if (this.onDiagnostic) this.onDiagnostic(formatted);
		else if (this.debug) console.error(formatted);
	}
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout?: NodeJS.Timeout;
	method: string;
	abortSignal?: AbortSignal;
	abort: () => void;
}

interface ActiveSubscription {
	acknowledged: boolean;
	readonly onNotification: McpSubscriptionHandler;
}

function isTaskResult(value: unknown): value is McpCreateTaskResult {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		"resultType" in value &&
		value.resultType === "task" &&
		"taskId" in value &&
		typeof value.taskId === "string"
	);
}

function readServerInfo(result: {
	readonly _meta?: Record<string, unknown>;
}): { name: string; version: string } | undefined {
	const info = result._meta?.["io.modelcontextprotocol/serverInfo"];
	if (!info || typeof info !== "object" || Array.isArray(info)) return undefined;
	const value = info as Record<string, unknown>;
	return typeof value.name === "string" && typeof value.version === "string"
		? { name: value.name, version: value.version }
		: undefined;
}

function assertResult<T>(
	method: string,
	value: unknown,
	guard: (value: unknown) => value is T,
	onInvalid?: (message: string) => void,
): T {
	if (guard(value)) return value;
	const message = `Invalid MCP ${method} result`;
	onInvalid?.(message);
	throw new Error(message);
}

function isCompleteResult(value: unknown): value is McpUpdateTaskResult {
	return isRecord(value) && value.resultType === "complete";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorName(error: unknown): string {
	return error instanceof Error ? error.name : "unknown";
}

function normalizeSubscriptionFilter(filter: McpSubscriptionFilter): Record<string, unknown> {
	return {
		...(filter.toolsListChanged === undefined ? {} : { toolsListChanged: filter.toolsListChanged }),
		...(filter.promptsListChanged === undefined ? {} : { promptsListChanged: filter.promptsListChanged }),
		...(filter.resourcesListChanged === undefined ? {} : { resourcesListChanged: filter.resourcesListChanged }),
		...(filter.resourceSubscriptions === undefined ? {} : { resourceSubscriptions: filter.resourceSubscriptions }),
	};
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
