import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { SubagentCoordinatorPort } from "@vetta/runtime-subagents";
import { ToolCallDescriptionSchema } from "../../shared/tool-call-description.js";
import { SPAWN_AGENT_TOOL_DESCRIPTION } from "./description.js";

export const SpawnAgentToolInputSchema = Type.Object({
	description: ToolCallDescriptionSchema,
	task_name: Type.String({
		description:
			"Unique snake_case name for this child under the root (e.g. api_trace). Lowercase letters, digits, underscore; start with a letter.",
	}),
	message: Type.String({
		description: "Task instructions for the subagent. Be specific about what to investigate and what to return.",
	}),
	agent_type: Type.String({
		description: "Registered subagent type id (e.g. explorer). See tool description for available types.",
	}),
});

export type SpawnAgentToolInput = Static<typeof SpawnAgentToolInputSchema>;

export interface SpawnAgentToolOptions {
	readonly getCoordinator: () => SubagentCoordinatorPort | undefined;
}

export function createSpawnAgentTool(options: SpawnAgentToolOptions): RuntimeToolDefinition<SpawnAgentToolInput> {
	return {
		name: "spawn_agent",
		label: "spawn_agent",
		description: SPAWN_AGENT_TOOL_DESCRIPTION,
		inputSchema: SpawnAgentToolInputSchema,
		async execute({ input }) {
			const coordinator = requireCoordinator(options);
			const snapshot = await coordinator.spawn({
				taskName: input.task_name,
				message: input.message,
				agentType: input.agent_type,
			});
			const text = [
				`Spawned subagent ${snapshot.id}`,
				`path: ${snapshot.path}`,
				`type: ${snapshot.agentType}`,
				`status: ${snapshot.status}`,
				`task_name: ${snapshot.taskName}`,
				"Use wait_agent to join, or continue and handle <subagent_notification>.",
			].join("\n");
			return {
				content: [{ type: "text", text }],
				details: { ...snapshot },
			};
		},
	};
}

function requireCoordinator(options: SpawnAgentToolOptions): SubagentCoordinatorPort {
	const coordinator = options.getCoordinator();
	if (!coordinator) throw new Error("Subagents are not enabled for this session.");
	return coordinator;
}
