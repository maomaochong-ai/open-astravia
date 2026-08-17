import type { UserMessage } from "@vetta/ai";
import type { TodoContinuationState } from "./contracts.js";

/**
 * 只有被 scene 等机制锁定的 Todo 列表才会驱动续跑。
 *
 * 普通 Todo 是用户可见的进度面板，不再对模型发主动提醒——那种“鞭策”会在用户
 * 已经改变意图之后继续推动旧计划。
 */
export function buildTodoContinuationMessages(
	state: TodoContinuationState,
	now: () => number = Date.now,
): UserMessage[] {
	if (!state.isLocked()) return [];
	const items = state.getAll();
	const pending = items.filter((item) => item.status !== "done").sort((left, right) => left.id - right.id);
	if (pending.length === 0) return [];

	const nextItem = pending[0];
	const pendingList = pending.map((item) => `  #${item.id} ${item.content}`).join("\n");
	const doneCount = items.length - pending.length;
	return [
		{
			role: "user",
			content: [
				{
					type: "text",
					text: `[ephemeral:todo] You have ${pending.length} uncompleted todo items (${doneCount}/${items.length} done). You MUST continue working on them before stopping.\n\nRemaining:\n${pendingList}\n\nYou MUST work on item #${nextItem.id} next: "${nextItem.content}"\nCall todo(action="update", id=${nextItem.id}, status="in_progress") first, then do the work, then mark it done. Do NOT skip to a later item.`,
				},
			],
			timestamp: now(),
		},
	];
}
