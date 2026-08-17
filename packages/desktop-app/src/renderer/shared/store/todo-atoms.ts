import { atom } from "jotai";

export interface TodoItem {
	id: number;
	content: string;
	status: "pending" | "in_progress" | "done";
}

/**
 * 当前会话的 todo 列表。
 * 由 Coding Agent Todo extension observation 驱动更新，按 sessionId 隔离。
 * Map<sessionId, TodoItem[]>
 */
export const todoItemsBySessionAtom = atom<Map<string, TodoItem[]>>(new Map());

export function getTodoItemsForSession(map: Map<string, TodoItem[]>, sessionId: string | null | undefined): TodoItem[] {
	if (!sessionId) return [];
	return map.get(sessionId) ?? [];
}
