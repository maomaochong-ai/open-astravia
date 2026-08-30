import type { McpInputRequests, McpInputResponses } from "./interaction.js";
import type { McpJsonObject, McpMeta } from "./json.js";

export const MCP_TASKS_EXTENSION_ID = "io.modelcontextprotocol/tasks" as const;

export type McpTaskStatus = "working" | "input_required" | "completed" | "failed" | "cancelled";

export interface McpTask {
	readonly taskId: string;
	readonly status: McpTaskStatus;
	readonly statusMessage?: string;
	readonly createdAt: string;
	readonly lastUpdatedAt: string;
	readonly ttlMs: number | null;
	readonly pollIntervalMs?: number;
}

export interface McpWorkingTask extends McpTask {
	readonly status: "working";
}

export interface McpInputRequiredTask extends McpTask {
	readonly status: "input_required";
	readonly inputRequests: McpInputRequests;
}

export interface McpCompletedTask extends McpTask {
	readonly status: "completed";
	readonly result: McpJsonObject;
}

export interface McpFailedTask extends McpTask {
	readonly status: "failed";
	readonly error: { readonly code: number; readonly message: string; readonly data?: unknown };
}

export interface McpCancelledTask extends McpTask {
	readonly status: "cancelled";
}

export type McpDetailedTask =
	| McpWorkingTask
	| McpInputRequiredTask
	| McpCompletedTask
	| McpFailedTask
	| McpCancelledTask;

export interface McpCreateTaskResult extends McpTask {
	readonly resultType: "task";
	readonly _meta?: McpMeta;
}

export type McpGetTaskResult = McpDetailedTask & { readonly resultType: "complete"; readonly _meta?: McpMeta };

export interface McpUpdateTaskResult {
	readonly resultType: "complete";
	readonly _meta?: McpMeta;
}

export type McpCancelTaskResult = McpUpdateTaskResult;

export interface McpGetTaskParams {
	readonly taskId: string;
}

export interface McpUpdateTaskParams {
	readonly taskId: string;
	readonly inputResponses: McpInputResponses;
}

export interface McpCancelTaskParams {
	readonly taskId: string;
}

export interface McpTaskWaitOptions {
	readonly timeoutMs?: number;
	readonly signal?: AbortSignal;
	readonly onStatus?: (task: McpGetTaskResult) => void | Promise<void>;
}

export function isMcpTaskTerminal(status: McpTaskStatus): boolean {
	return status === "completed" || status === "failed" || status === "cancelled";
}

export type McpTasksExtensionCapability = Record<string, never>;
