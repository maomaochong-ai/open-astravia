import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import type {
	McpCancelTaskParams,
	McpCancelTaskResult,
	McpCreateTaskResult,
	McpGetTaskParams,
	McpGetTaskResult,
	McpRequestOptions,
	McpTaskStatus,
	McpTaskWaitOptions,
	McpToolCallResult,
} from "../protocol/index.js";
import { isMcpToolCallResult } from "../protocol/index.js";
import type { McpToolResultContext, McpToolResultPolicy } from "../tools/mcp-tool-result-policy.js";

export interface McpTaskExecutionSnapshot {
	readonly id: string;
	readonly taskId: string;
	readonly sessionId: string;
	readonly turnId: string;
	readonly toolCallId: string;
	readonly serverName: string;
	readonly toolName: string;
	readonly status: McpTaskStatus;
	readonly statusMessage?: string;
	readonly createdAt: string;
	readonly lastUpdatedAt: string;
	readonly ttlMs: number | null;
	readonly pollIntervalMs?: number;
	readonly recovered?: boolean;
}

export interface McpTaskExecutionStore {
	list(): Promise<readonly McpTaskExecutionSnapshot[]>;
	upsert(snapshot: McpTaskExecutionSnapshot): Promise<void>;
}

export interface McpTaskExecutionCoordinatorOptions {
	readonly store?: McpTaskExecutionStore;
	readonly waitTimeoutMs?: number;
	readonly onDiagnostic?: (message: string) => void;
}

export interface McpTaskClient {
	waitForTask?(params: McpGetTaskParams, options?: McpTaskWaitOptions): Promise<McpGetTaskResult>;
	cancelTask?(params: McpCancelTaskParams, options?: McpRequestOptions): Promise<McpCancelTaskResult>;
}

export interface McpTaskToolExecutionOptions {
	readonly context: McpToolResultContext;
	readonly resultPolicy: McpToolResultPolicy;
	readonly signal?: AbortSignal;
	readonly onUpdate?: (result: RuntimeToolResult) => void;
}

export interface McpTaskToolResultWaitOptions {
	readonly context: McpToolResultContext;
	readonly signal?: AbortSignal;
	readonly onUpdate?: (result: RuntimeToolResult) => void;
}

export interface McpRecoverableServerBinding {
	readonly view: { readonly name: string };
	readonly client?: McpTaskClient;
}

interface ActiveTask {
	readonly client: McpTaskClient;
	readonly taskId: string;
	readonly promise: Promise<McpGetTaskResult>;
}

/**
 * Owns MCP Task polling, cancellation and restart recovery without leaking Task state
 * into the Agent loop or Desktop-specific background-process contracts.
 */
export class McpTaskExecutionCoordinator {
	private readonly active = new Map<string, ActiveTask>();

	constructor(private readonly options: McpTaskExecutionCoordinatorOptions = {}) {}

	async completeToolTask(
		client: McpTaskClient,
		created: McpCreateTaskResult,
		options: McpTaskToolExecutionOptions,
	): Promise<RuntimeToolResult> {
		try {
			const result = await this.waitForToolTaskResult(client, created, options);
			return options.resultPolicy.project(result, options.context);
		} catch (error) {
			if (isAbortError(error) || options.signal?.aborted) throw error;
			return taskError(error instanceof Error ? error.message : "MCP task wait failed");
		}
	}

	/** Waits for the raw final ToolResult so non-Agent hosts such as MCP Apps can reuse Task ownership. */
	async waitForToolTaskResult(
		client: McpTaskClient,
		created: McpCreateTaskResult,
		options: McpTaskToolResultWaitOptions,
	): Promise<McpToolCallResult> {
		if (!client.waitForTask) throw new Error("MCP client cannot wait for the created task");
		const initial = toSnapshot(created, options.context);
		await this.record(initial, options.onUpdate);
		try {
			const task = await this.poll(initial, client, options.signal, options.onUpdate);
			if (task.status === "completed") {
				if (!isMcpToolCallResult(task.result, { era: "modern" })) {
					throw new Error("MCP task completed with an invalid tool result");
				}
				return task.result;
			}
			if (task.status === "failed") throw new Error(task.error.message || "MCP task failed");
			throw new Error("MCP task was cancelled");
		} catch (error) {
			if (isAbortError(error) || options.signal?.aborted) {
				await client.cancelTask?.({ taskId: initial.taskId }).catch(() => undefined);
				throw error;
			}
			this.log(`task wait failed server=${options.context.serverName} error=${errorName(error)}`);
			throw error;
		}
	}

	async recover(bindings: readonly McpRecoverableServerBinding[]): Promise<void> {
		const store = this.options.store;
		if (!store) return;
		const clients = new Map(
			bindings.flatMap((binding) => (binding.client ? [[binding.view.name, binding.client] as const] : [])),
		);
		for (const snapshot of await store.list()) {
			if (isTerminal(snapshot.status) || this.active.has(snapshot.id)) continue;
			const client = clients.get(snapshot.serverName);
			if (!client?.waitForTask) continue;
			const recovered = { ...snapshot, recovered: true };
			void this.poll(recovered, client).catch((error) => {
				this.log(`task recovery deferred server=${snapshot.serverName} error=${errorName(error)}`);
			});
		}
	}

	async cancel(id: string): Promise<boolean> {
		const active = this.active.get(id);
		if (!active?.client.cancelTask) return false;
		await active.client.cancelTask({ taskId: active.taskId });
		this.log("task cancellation acknowledged");
		return true;
	}

	private poll(
		initial: McpTaskExecutionSnapshot,
		client: McpTaskClient,
		signal?: AbortSignal,
		onUpdate?: (result: RuntimeToolResult) => void,
	): Promise<McpGetTaskResult> {
		const existing = this.active.get(initial.id);
		if (existing) return existing.promise;
		if (!client.waitForTask) return Promise.reject(new Error("MCP client cannot wait for tasks"));
		const promise = client
			.waitForTask(
				{ taskId: initial.taskId },
				{
					...(this.options.waitTimeoutMs === undefined ? {} : { timeoutMs: this.options.waitTimeoutMs }),
					...(signal ? { signal } : {}),
					onStatus: async (task) => this.record(toSnapshot(task, initial), onUpdate),
				},
			)
			.finally(() => this.active.delete(initial.id));
		this.active.set(initial.id, { client, taskId: initial.taskId, promise });
		return promise;
	}

	private async record(
		snapshot: McpTaskExecutionSnapshot,
		onUpdate?: (result: RuntimeToolResult) => void,
	): Promise<void> {
		try {
			await this.options.store?.upsert(snapshot);
		} catch (error) {
			this.log(`task state persistence failed server=${snapshot.serverName} error=${errorName(error)}`);
		}
		onUpdate?.({
			content: [{ type: "text", text: `MCP task status: ${snapshot.status}` }],
			details: { mcpTask: publicSnapshot(snapshot) },
		});
	}

	private log(message: string): void {
		this.options.onDiagnostic?.(message);
	}
}

function toSnapshot(
	task: McpCreateTaskResult | McpGetTaskResult,
	context: McpToolResultContext | McpTaskExecutionSnapshot,
): McpTaskExecutionSnapshot {
	const base =
		"id" in context
			? context
			: {
					id: taskExecutionId(context.sessionId, context.serverName, task.taskId),
					taskId: task.taskId,
					sessionId: context.sessionId,
					turnId: context.turnId,
					toolCallId: context.toolCallId,
					serverName: context.serverName,
					toolName: context.toolName,
				};
	return {
		id: base.id,
		taskId: base.taskId,
		sessionId: base.sessionId,
		turnId: base.turnId,
		toolCallId: base.toolCallId,
		serverName: base.serverName,
		toolName: base.toolName,
		status: task.status,
		...(task.statusMessage === undefined ? {} : { statusMessage: task.statusMessage.slice(0, 2000) }),
		createdAt: task.createdAt,
		lastUpdatedAt: task.lastUpdatedAt,
		ttlMs: task.ttlMs,
		...(task.pollIntervalMs === undefined ? {} : { pollIntervalMs: task.pollIntervalMs }),
		...("recovered" in base && base.recovered ? { recovered: true } : {}),
	};
}

function publicSnapshot(snapshot: McpTaskExecutionSnapshot): Omit<McpTaskExecutionSnapshot, "taskId"> {
	const { taskId: _taskId, ...safe } = snapshot;
	return safe;
}

function taskError(message: string): RuntimeToolResult {
	return {
		content: [{ type: "text", text: message }],
		details: { content: [{ type: "text", text: message }], isError: true },
		isError: true,
	};
}

function isTerminal(status: McpTaskStatus): boolean {
	return status === "completed" || status === "failed" || status === "cancelled";
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

function errorName(error: unknown): string {
	return error instanceof Error ? error.name : typeof error;
}

function taskExecutionId(sessionId: string, serverName: string, taskId: string): string {
	const value = JSON.stringify([sessionId, serverName, taskId]);
	let first = 0x811c9dc5;
	let second = 0x9e3779b9;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		first = Math.imul(first ^ code, 0x01000193);
		second = Math.imul(second ^ code, 0x85ebca6b);
	}
	return `mcp-task-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}
