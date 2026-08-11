export interface CompactionTodoStateItem {
	readonly id: number;
	readonly content: string;
	readonly status: "pending" | "in_progress" | "done";
}

export interface CompactionBackgroundTaskState {
	readonly id: string;
	readonly command: string;
	readonly status: "running" | "completed" | "failed" | "killed";
	readonly outputFile: string;
	readonly exitCode?: number;
}

export interface CompactionWorkStateSnapshot {
	readonly todos: readonly CompactionTodoStateItem[];
	readonly backgroundTasks: readonly CompactionBackgroundTaskState[];
}

const WORK_STATE_PATTERN = /\n*<runtime-work-state>[\s\S]*?<\/runtime-work-state>\n*/g;

export function appendCompactionWorkState(summary: string, state: CompactionWorkStateSnapshot | undefined): string {
	const withoutPreviousState = summary.replace(WORK_STATE_PATTERN, "\n").trim();
	if (!state || (state.todos.length === 0 && state.backgroundTasks.length === 0)) return withoutPreviousState;
	const todos = state.todos.map((item) => ({ ...item, content: truncate(item.content, 1_000) }));
	const backgroundTasks = selectBackgroundTasks(state.backgroundTasks).map((task) => ({
		...task,
		command: truncate(task.command, 512),
	}));
	const unfinished = todos.filter(({ status }) => status !== "done");
	const next = unfinished.find(({ status }) => status === "in_progress") ?? unfinished[0];
	const plan = {
		status: todos.length === 0 ? "none" : unfinished.length === 0 ? "completed" : "active",
		completed: todos.length - unfinished.length,
		total: todos.length,
		...(next ? { nextTodoId: next.id } : {}),
	};
	return `${withoutPreviousState}\n\n<runtime-work-state>\n${JSON.stringify({ plan, todos, backgroundTasks })}\n</runtime-work-state>`;
}

function selectBackgroundTasks(
	tasks: readonly CompactionBackgroundTaskState[],
): readonly CompactionBackgroundTaskState[] {
	const running = tasks.filter(({ status }) => status === "running");
	const finished = tasks.filter(({ status }) => status !== "running").slice(-10);
	return [...running, ...finished];
}

function truncate(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...[truncated]`;
}
