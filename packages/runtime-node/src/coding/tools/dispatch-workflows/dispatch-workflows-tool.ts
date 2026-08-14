import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { SubagentCoordinatorPort } from "@vetta/runtime-subagents";
import { ToolCallDescriptionSchema } from "../../shared/tool-call-description.js";
import { DISPATCH_WORKFLOWS_TOOL_DESCRIPTION } from "./description.js";

export const DISPATCH_WORKFLOWS_MAX_BATCH = 8;

const WorkflowItemSchema = Type.Object({
	task_name: Type.String({
		description:
			"Unique snake_case id for this workflow (e.g. refactor_api). Lowercase letters, digits, underscore; start with a letter.",
	}),
	title: Type.String({
		description:
			"Human-readable one-line summary of this workflow, shown in the UI (e.g. 重构 API 鉴权层). Write it in the user's language.",
	}),
	message: Type.String({
		description:
			"Task brief for this workflow. It already sees a snapshot of this conversation; state its scope and deliverables.",
	}),
	todos: Type.Array(Type.String(), {
		minItems: 1,
		description: "Ordered todo items pre-filled into the workflow's own todo list.",
	}),
});

export const DispatchWorkflowsToolInputSchema = Type.Object({
	description: ToolCallDescriptionSchema,
	workflows: Type.Array(WorkflowItemSchema, {
		minItems: 1,
		maxItems: DISPATCH_WORKFLOWS_MAX_BATCH,
		description: `Workflows to dispatch in one batch (max ${DISPATCH_WORKFLOWS_MAX_BATCH}).`,
	}),
});

export type DispatchWorkflowsToolInput = Static<typeof DispatchWorkflowsToolInputSchema>;

export interface DispatchWorkflowsToolOptions {
	readonly getCoordinator: () => SubagentCoordinatorPort | undefined;
	readonly workflowTypeId: string;
}

export function createDispatchWorkflowsTool(
	options: DispatchWorkflowsToolOptions,
): RuntimeToolDefinition<DispatchWorkflowsToolInput> {
	return {
		name: "dispatch_workflows",
		label: "dispatch_workflows",
		description: DISPATCH_WORKFLOWS_TOOL_DESCRIPTION,
		inputSchema: DispatchWorkflowsToolInputSchema,
		async execute({ input }) {
			const coordinator = requireCoordinator(options);
			const snapshots = coordinator.spawnMany(
				input.workflows.map((workflow) => ({
					taskName: workflow.task_name,
					title: workflow.title,
					message: workflow.message,
					agentType: options.workflowTypeId,
					todos: workflow.todos,
				})),
			);
			const lines = [`Dispatched ${snapshots.length} workflow(s):`];
			for (const snapshot of snapshots) {
				const todo = snapshot.todoProgress
					? ` todos: ${snapshot.todoProgress.done}/${snapshot.todoProgress.total}`
					: "";
				lines.push(`- ${snapshot.taskName} [${snapshot.status}] id: ${snapshot.id}${todo}`);
			}
			lines.push(
				"You will receive <subagent_notification> as each workflow reaches a terminal state. Do NOT call wait_agent — end your turn (or continue other work) and handle the notifications passively.",
			);
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { workflows: snapshots },
			};
		},
	};
}

function requireCoordinator(options: DispatchWorkflowsToolOptions): SubagentCoordinatorPort {
	const coordinator = options.getCoordinator();
	if (!coordinator) throw new Error("Subagents are not enabled for this session.");
	return coordinator;
}
