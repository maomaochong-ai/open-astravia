import type { DesktopMcpTask } from "@preload/api";
import { atom } from "jotai";

/** Durable MCP protocol Tasks, kept separate from Vetta bash/subagent background work. */
export const mcpTasksBySessionAtom = atom<Map<string, DesktopMcpTask[]>>(new Map());

export function groupMcpTasksBySession(tasks: readonly DesktopMcpTask[]): Map<string, DesktopMcpTask[]> {
	const grouped = new Map<string, DesktopMcpTask[]>();
	for (const task of tasks) {
		const sessionTasks = grouped.get(task.sessionId) ?? [];
		sessionTasks.push(task);
		grouped.set(task.sessionId, sessionTasks);
	}
	return grouped;
}

export function getMcpTasksForSession(
	map: ReadonlyMap<string, readonly DesktopMcpTask[]>,
	sessionId: string | null | undefined,
): readonly DesktopMcpTask[] {
	return sessionId ? (map.get(sessionId) ?? []) : [];
}
