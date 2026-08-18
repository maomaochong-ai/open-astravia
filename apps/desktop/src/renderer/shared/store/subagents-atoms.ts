import { atom } from "jotai";

/** Mirrors runtime-core SubagentInfo / coding-agent SubagentSnapshot. */
export interface SubagentTask {
	id: string;
	taskName: string;
	path: string;
	agentType: string;
	status: "queued" | "pending" | "running" | "completed" | "failed" | "interrupted";
	task: string;
	parentSessionId: string;
	sessionFile?: string;
	startedAt: number;
	endedAt?: number;
	finalText?: string;
	errorMessage?: string;
	generation: number;
	/** Workflow children mirror their todo progress (display only). */
	todoProgress?: { done: number; total: number };
	/** Human-readable one-line summary for UI display. */
	title?: string;
}

/** Display name for a workflow: human-readable title, falling back to the id. */
export function workflowDisplayName(task: SubagentTask): string {
	return task.title?.trim() || task.taskName;
}

/** Workflow children (dispatch_workflows) shown in the footer items + workflow tab. */
export function isWorkflowTask(task: SubagentTask): boolean {
	return task.agentType === "workflow";
}

/** Workflow selected in the activity panel's workflow tab (footer click targets it). */
export const selectedWorkflowIdAtom = atom<string | null>(null);

/**
 * Subagent children for the root session.
 * Driven by subagents_update full snapshots, keyed by sessionId.
 */
export const subagentsBySessionAtom = atom<Map<string, SubagentTask[]>>(new Map());

export function getSubagentsForSession(
	map: Map<string, SubagentTask[]>,
	sessionId: string | null | undefined,
): SubagentTask[] {
	if (!sessionId) return [];
	return map.get(sessionId) ?? [];
}

export function isSubagentActive(status: SubagentTask["status"]): boolean {
	return status === "queued" || status === "pending" || status === "running";
}
