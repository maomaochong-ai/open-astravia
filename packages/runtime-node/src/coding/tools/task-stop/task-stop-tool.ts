import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { BackgroundCommandService, BackgroundCommandStatus } from "../../shared/background-command-service.js";
import { TASK_STOP_TOOL_DESCRIPTION } from "./description.js";

export const TaskStopToolInputSchema = Type.Object({
	description: Type.Optional(
		Type.String({
			description: "Brief user-facing reason for this tool call (max 100 chars).",
			maxLength: 100,
		}),
	),
	task_id: Type.String({ description: "Background task ID (e.g. b1) to terminate" }),
});

export type TaskStopToolInput = Static<typeof TaskStopToolInputSchema>;

export interface TaskStopToolDetails {
	readonly taskId: string;
	readonly status: BackgroundCommandStatus;
}

export interface TaskStopToolOptions {
	readonly backgroundService: BackgroundCommandService;
}

export function createTaskStopTool(options: TaskStopToolOptions): RuntimeToolDefinition<TaskStopToolInput> {
	return {
		name: "task_stop",
		label: "task_stop",
		description: TASK_STOP_TOOL_DESCRIPTION,
		inputSchema: TaskStopToolInputSchema,
		async execute(request) {
			const task = options.backgroundService.get(request.input.task_id);
			if (!task) {
				throw new Error(`Background task "${request.input.task_id}" not found.`);
			}
			if (task.status !== "running") {
				return {
					content: [
						{
							type: "text",
							text: `Task ${task.id} is not running (status: ${task.status}${task.exitCode !== undefined ? `, exit code ${task.exitCode}` : ""}).`,
						},
					],
					details: { taskId: task.id, status: task.status } satisfies TaskStopToolDetails,
				};
			}

			options.backgroundService.stop(task.id, "agent");
			return {
				content: [
					{
						type: "text",
						text: `Sent kill signal to task ${task.id} ("${task.command}"). A <task-notification> will confirm termination.`,
					},
				],
				details: { taskId: task.id, status: task.status } satisfies TaskStopToolDetails,
			};
		},
	};
}
