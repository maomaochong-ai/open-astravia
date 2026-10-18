import type { TodoItem } from "./contracts.js";

const STATUS_ICON: Record<TodoItem["status"], string> = {
	pending: "[ ]",
	in_progress: "[~]",
	done: "[x]",
};

export type FormattableTodoItem = Pick<TodoItem, "id" | "content" | "status">;

/** 模型可读的清单文本；工具结果与系统指令共用同一格式，避免两处描述漂移。 */
export function formatTodoItems(items: readonly FormattableTodoItem[], emptyText = "No todo items."): string {
	if (items.length === 0) return emptyText;
	const lines = items.map((item) => `${STATUS_ICON[item.status]} #${item.id} ${item.content}`);
	lines.push("", `Progress: ${items.filter((item) => item.status === "done").length}/${items.length} completed`);
	return lines.join("\n");
}
