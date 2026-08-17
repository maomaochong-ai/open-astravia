import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { BackgroundCommandService, BackgroundCommandStatus } from "../../shared/background-command-service.js";
import { truncateTail } from "../../shared/truncation.js";
import { TASK_OUTPUT_TOOL_DESCRIPTION } from "./description.js";

export const TaskOutputToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({
			description: "Brief user-facing reason for this tool call (max 100 chars).",
			maxLength: 100,
		}),
	),
	task_id: Type.String({ description: "Background task ID (e.g. b1) returned by bash with run_in_background" }),
	from_start: Type.Optional(
		Type.Boolean({
			description:
				"Read from the beginning of the output instead of continuing after the last read (default: false)",
		}),
	),
});

export type TaskOutputToolInput = Static<typeof TaskOutputToolInputSchema>;

export interface TaskOutputToolDetails {
	readonly taskId: string;
	readonly status: BackgroundCommandStatus;
	readonly outputFile: string;
}

export interface TaskOutputToolOptions {
	readonly backgroundService: BackgroundCommandService;
}

export function createTaskOutputTool(options: TaskOutputToolOptions): RuntimeToolDefinition<TaskOutputToolInput> {
	return {
		name: "task_output",
		label: "task_output",
		description: TASK_OUTPUT_TOOL_DESCRIPTION,
		inputSchema: TaskOutputToolInputSchema,
		async execute(request) {
			const task = options.backgroundService.get(request.input.task_id);
			if (!task) {
				throw new Error(`Background task "${request.input.task_id}" not found.`);
			}

			const fromStart = request.input.from_start ?? false;
			const chunk = options.backgroundService.readOutput(task.id, {
				fromStart,
				advanceCursor: true,
			});
			const statusLine =
				task.status === "running"
					? `Task ${task.id} is running (started ${new Date(task.startedAt).toISOString()})`
					: `Task ${task.id} ${task.status}${task.exitCode !== undefined ? ` (exit code ${task.exitCode})` : ""}`;
			let text: string;

			if (chunk) {
				const truncation = truncateTail(chunk);
				text = `${statusLine}\n\n${truncation.content}`;
				if (truncation.truncated) {
					text += `\n\n[Output truncated. Full output: ${task.outputFile}]`;
				}
			} else {
				text = `${statusLine}\n\n(no new output${fromStart ? "" : " since last read"})`;
			}

			return {
				content: [{ type: "text", text }],
				details: {
					taskId: task.id,
					status: task.status,
					outputFile: task.outputFile,
				} satisfies TaskOutputToolDetails,
			};
		},
	};
}
