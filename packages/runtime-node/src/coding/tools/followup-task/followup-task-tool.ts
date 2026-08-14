import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { SubagentCoordinatorPort } from "@vetta/runtime-subagents";
import { ToolCallDescriptionSchema } from "../../shared/tool-call-description.js";
import { FOLLOWUP_TASK_TOOL_DESCRIPTION } from "./description.js";

export const FollowupTaskToolInputSchema = Type.Object({
	description: ToolCallDescriptionSchema,
	target: Type.String({ description: "Child id, task_name, or /root/<task_name>" }),
	message: Type.String({ description: "Follow-up task for the same child transcript." }),
});

export type FollowupTaskToolInput = Static<typeof FollowupTaskToolInputSchema>;

export interface FollowupTaskToolOptions {
	readonly getCoordinator: () => SubagentCoordinatorPort | undefined;
}

export function createFollowupTaskTool(options: FollowupTaskToolOptions): RuntimeToolDefinition<FollowupTaskToolInput> {
	return {
		name: "followup_task",
		label: "followup_task",
		description: FOLLOWUP_TASK_TOOL_DESCRIPTION,
		inputSchema: FollowupTaskToolInputSchema,
		async execute({ input }) {
			const snapshot = await requireCoordinator(options).followUp(input.target, input.message);
			return {
				content: [
					{
						type: "text",
						text: `Follow-up dispatched to ${snapshot.id} (${snapshot.path}), status=${snapshot.status}`,
					},
				],
				details: { ...snapshot },
			};
		},
	};
}

function requireCoordinator(options: FollowupTaskToolOptions): SubagentCoordinatorPort {
	const coordinator = options.getCoordinator();
	if (!coordinator) throw new Error("Subagents are not enabled for this session.");
	return coordinator;
}
