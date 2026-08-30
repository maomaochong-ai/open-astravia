import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { McpTaskExecutionSnapshot, McpTaskExecutionStore } from "@vetta/runtime-mcp";
import { atomicWriteJSONAsync } from "@vetta/toolkit/atomic-write";
import type { DesktopMcpTask, DesktopMcpTasksChangedEvent } from "../../shared/mcp-task.js";

const STORE_VERSION = 1;
const MAX_RECORDS = 200;
const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60_000;
const TASK_EXECUTION_ID_PATTERN = /^mcp-task-[a-z0-9]+-[a-z0-9]+$/;

type ChangedListener = (event: DesktopMcpTasksChangedEvent) => void;

interface PersistedMcpTaskState {
	readonly version: typeof STORE_VERSION;
	readonly tasks: readonly McpTaskExecutionSnapshot[];
}

export interface DesktopMcpTaskRegistryOptions {
	readonly filePath?: string;
	readonly now?: () => number;
}

/** Durable, content-minimized Task registry. Raw results and input requests are never persisted. */
export class DesktopMcpTaskRegistry implements McpTaskExecutionStore {
	private readonly tasks = new Map<string, McpTaskExecutionSnapshot>();
	private readonly listeners = new Set<ChangedListener>();
	private readonly filePath: string;
	private readonly now: () => number;
	private readonly ready: Promise<void>;
	private writeQueue = Promise.resolve();

	constructor(options: DesktopMcpTaskRegistryOptions = {}) {
		this.filePath = options.filePath ?? join(getVettaHomePath(), "desktop-app", "mcp-tasks.json");
		this.now = options.now ?? Date.now;
		this.ready = this.load();
	}

	async list(): Promise<readonly McpTaskExecutionSnapshot[]> {
		await this.ready;
		this.prune();
		return [...this.tasks.values()];
	}

	async listPublic(sessionId?: string): Promise<DesktopMcpTask[]> {
		return (await this.list())
			.filter((task) => sessionId === undefined || task.sessionId === sessionId)
			.map(toDesktopTask)
			.sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt));
	}

	async upsert(snapshot: McpTaskExecutionSnapshot): Promise<void> {
		await this.ready;
		const normalized = normalizeSnapshot(snapshot);
		if (!normalized) return;
		const existing = this.tasks.get(normalized.id);
		if (existing) {
			if (!sameTaskIdentity(existing, normalized) || isTerminal(existing.status)) return;
			const existingRevision = Date.parse(existing.lastUpdatedAt);
			const nextRevision = Date.parse(normalized.lastUpdatedAt);
			if (
				nextRevision < existingRevision ||
				(nextRevision === existingRevision && sameSnapshot(existing, normalized))
			) {
				return;
			}
		}
		this.tasks.set(normalized.id, normalized);
		this.prune();
		await this.persist();
		await this.emitChanged();
	}

	async clearTerminal(sessionId: string): Promise<number> {
		await this.ready;
		let removed = 0;
		for (const [id, task] of this.tasks) {
			if (task.sessionId === sessionId && isTerminal(task.status)) {
				this.tasks.delete(id);
				removed += 1;
			}
		}
		if (removed > 0) {
			await this.persist();
			await this.emitChanged();
		}
		return removed;
	}

	onChanged(listener: ChangedListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private async load(): Promise<void> {
		try {
			const parsed: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
			if (!isRecord(parsed) || parsed.version !== STORE_VERSION || !Array.isArray(parsed.tasks)) return;
			for (const candidate of parsed.tasks) {
				const snapshot = normalizeSnapshot(candidate);
				if (snapshot) this.tasks.set(snapshot.id, snapshot);
			}
			this.prune();
		} catch {
			// Missing/corrupt recovery state is non-fatal and is replaced on the next update.
		}
	}

	private persist(): Promise<void> {
		const state: PersistedMcpTaskState = { version: STORE_VERSION, tasks: [...this.tasks.values()] };
		this.writeQueue = this.writeQueue.catch(() => undefined).then(() => atomicWriteJSONAsync(this.filePath, state));
		return this.writeQueue;
	}

	private async emitChanged(): Promise<void> {
		const event = { tasks: await this.listPublic() };
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				// A disposed Renderer listener must not break durable task state.
			}
		}
	}

	private prune(): void {
		const now = this.now();
		for (const [id, task] of this.tasks) {
			const updatedAt = Date.parse(task.lastUpdatedAt);
			const expiredByTtl = task.ttlMs !== null && Number.isFinite(updatedAt) && updatedAt + task.ttlMs < now;
			const expiredTerminal =
				isTerminal(task.status) && Number.isFinite(updatedAt) && updatedAt + TERMINAL_RETENTION_MS < now;
			if (expiredByTtl || expiredTerminal) this.tasks.delete(id);
		}
		if (this.tasks.size <= MAX_RECORDS) return;
		const oldest = [...this.tasks.values()].sort((left, right) =>
			left.lastUpdatedAt.localeCompare(right.lastUpdatedAt),
		);
		for (const task of oldest.slice(0, this.tasks.size - MAX_RECORDS)) this.tasks.delete(task.id);
	}
}

function normalizeSnapshot(value: unknown): McpTaskExecutionSnapshot | undefined {
	if (!isRecord(value)) return undefined;
	if (
		!isString(value.id) ||
		!TASK_EXECUTION_ID_PATTERN.test(value.id) ||
		!isString(value.taskId) ||
		!isString(value.sessionId) ||
		!isString(value.turnId) ||
		!isString(value.toolCallId) ||
		!isString(value.serverName) ||
		!isString(value.toolName) ||
		!isStatus(value.status) ||
		!isIsoDate(value.createdAt) ||
		!isIsoDate(value.lastUpdatedAt) ||
		!(value.ttlMs === null || (typeof value.ttlMs === "number" && Number.isInteger(value.ttlMs) && value.ttlMs >= 0))
	)
		return undefined;
	return {
		id: value.id,
		taskId: value.taskId.slice(0, 512),
		sessionId: value.sessionId.slice(0, 512),
		turnId: value.turnId.slice(0, 512),
		toolCallId: value.toolCallId.slice(0, 512),
		serverName: value.serverName.slice(0, 256),
		toolName: value.toolName.slice(0, 256),
		status: value.status,
		...(isString(value.statusMessage) ? { statusMessage: value.statusMessage.slice(0, 2000) } : {}),
		createdAt: value.createdAt,
		lastUpdatedAt: value.lastUpdatedAt,
		ttlMs: value.ttlMs,
		...(typeof value.pollIntervalMs === "number" &&
		Number.isInteger(value.pollIntervalMs) &&
		value.pollIntervalMs >= 0
			? { pollIntervalMs: value.pollIntervalMs }
			: {}),
		...(value.recovered === true ? { recovered: true } : {}),
	};
}

function toDesktopTask(task: McpTaskExecutionSnapshot): DesktopMcpTask {
	return {
		id: task.id,
		sessionId: task.sessionId,
		toolCallId: task.toolCallId,
		serverName: task.serverName,
		toolName: task.toolName,
		status: task.status,
		...(task.statusMessage === undefined ? {} : { statusMessage: task.statusMessage }),
		createdAt: task.createdAt,
		lastUpdatedAt: task.lastUpdatedAt,
		...(task.recovered ? { recovered: true } : {}),
	};
}

function isTerminal(status: McpTaskExecutionSnapshot["status"]): boolean {
	return status === "completed" || status === "failed" || status === "cancelled";
}

function sameTaskIdentity(left: McpTaskExecutionSnapshot, right: McpTaskExecutionSnapshot): boolean {
	return (
		left.taskId === right.taskId &&
		left.sessionId === right.sessionId &&
		left.turnId === right.turnId &&
		left.toolCallId === right.toolCallId &&
		left.serverName === right.serverName &&
		left.toolName === right.toolName
	);
}

function sameSnapshot(left: McpTaskExecutionSnapshot, right: McpTaskExecutionSnapshot): boolean {
	return (
		left.status === right.status &&
		left.statusMessage === right.statusMessage &&
		left.ttlMs === right.ttlMs &&
		left.pollIntervalMs === right.pollIntervalMs &&
		left.recovered === right.recovered
	);
}

function isStatus(value: unknown): value is McpTaskExecutionSnapshot["status"] {
	return (
		value === "working" ||
		value === "input_required" ||
		value === "completed" ||
		value === "failed" ||
		value === "cancelled"
	);
}

function isIsoDate(value: unknown): value is string {
	return isString(value) && Number.isFinite(Date.parse(value));
}

function isString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
