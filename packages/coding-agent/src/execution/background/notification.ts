import type { BackgroundCommandSnapshot } from "@vetta/runtime-tools";

/** 将通用后台命令快照投影为 Coding Agent 的模型上下文通知。 */
export function buildCodingAgentBackgroundCommandNotification(task: BackgroundCommandSnapshot): string {
	const statusText =
		task.status === "completed"
			? `completed (exit code ${task.exitCode ?? 0})`
			: task.status === "killed"
				? task.endedBy === "caller"
					? "was terminated by the user from the UI"
					: "was killed"
				: `failed (exit code ${task.exitCode ?? "unknown"})`;
	const summary = `Background command "${task.command}" ${statusText}`;
	const callerStopNote =
		task.status === "killed" && task.endedBy === "caller"
			? "The user manually stopped this background task. Do not restart it unless the user asks."
			: undefined;
	return [
		"<task-notification>",
		`<task-id>${task.id}</task-id>`,
		...(task.toolCallId ? [`<tool-use-id>${task.toolCallId}</tool-use-id>`] : []),
		`<status>${task.status}</status>`,
		...(task.endedBy ? [`<ended-by>${task.endedBy}</ended-by>`] : []),
		`<output-file>${task.outputFile}</output-file>`,
		`<summary>${summary}</summary>`,
		"</task-notification>",
		"",
		...(callerStopNote ? [callerStopNote, ""] : []),
		"Use the task_output tool to read the command output if needed.",
	].join("\n");
}
