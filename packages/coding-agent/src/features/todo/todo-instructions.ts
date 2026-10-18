import type { TodoItem } from "./contracts.js";
import { formatTodoItems } from "./todo-format.js";

export const TODO_INSTRUCTION_ID = "coding-agent.todo";

/** 高于常规能力说明，低于 plan 模式（900）与 goal（950）：清单是操作状态，模式说明更贴近对话。 */
export const TODO_INSTRUCTION_PRIORITY = 850;

/**
 * 把当前清单放进每次模型调用。
 *
 * 清单只存在于 Todo Runtime 与 UI，不会作为历史消息进入模型上下文；没有这一段时，
 * 模型只能靠 `todo(action="list")` 主动查询才可能发现上一份计划仍然存在，换任务时
 * 就表现为面板停在旧计划、`create` 被静默拒绝。
 */
export function renderTodoInstructions(items: readonly TodoItem[]): string {
	return [
		"# Current todo list",
		"",
		"This is the live state of this session's todo list. Earlier todo tool results may be stale or compacted away, so treat this block as authoritative.",
		"",
		"<todo_list>",
		formatTodoItems(items),
		"</todo_list>",
		"",
		"- Keep the list in sync: mark an item in_progress when you start it and done when you finish it.",
		"- If this plan still matches the work in front of you, continue it instead of creating another one.",
		'- If the user has moved on to a different task and this plan no longer applies, call todo(action="clear") and then todo(action="create") with the new plan before starting that work.',
	].join("\n");
}
