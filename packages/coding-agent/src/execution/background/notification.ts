import type { BackgroundCommandSnapshot } from "@astravia/runtime-tools";

/** 通知中随包回传的尾部输出上限：即使工具结果丢失，模型也能看到真实输出。 */
const OUTPUT_TAIL_MAX_CHARS = 2000;

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
	// 任务结束时的尾部输出随通知一并回传，避免只留下「结果缺失」的占位提示。
	const outputTail = task.tail.slice(-OUTPUT_TAIL_MAX_CHARS);
	const hasOutput = outputTail.trim().length > 0;
	return [
		"<task-notification>",
		`<task-id>${task.id}</task-id>`,
		...(task.toolCallId ? [`<tool-use-id>${task.toolCallId}</tool-use-id>`] : []),
		`<status>${task.status}</status>`,
		`<exit-code>${task.exitCode ?? "unknown"}</exit-code>`,
		...(task.endedBy ? [`<ended-by>${task.endedBy}</ended-by>`] : []),
		`<output-file>${task.outputFile}</output-file>`,
		`<summary>${summary}</summary>`,
		`<output-tail>${hasOutput ? `\n${outputTail}` : "(no output captured)"}</output-tail>`,
		"</task-notification>",
		"",
		...(callerStopNote ? [callerStopNote, ""] : []),
		hasOutput
			? "The output tail above is the end of the command output. Use the task_output tool to read more."
			: "No output was captured for this command. Use the task_output tool to inspect the output file if needed.",
	].join("\n");
}
