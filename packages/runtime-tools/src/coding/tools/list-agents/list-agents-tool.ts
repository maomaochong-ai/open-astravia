import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { SubagentCoordinatorPort } from "@vetta/runtime-subagents";
import { ToolCallDescriptionSchema } from "../../shared/tool-call-description.js";
import { LIST_AGENTS_TOOL_DESCRIPTION } from "./description.js";

export const ListAgentsToolInputSchema = Type.Object({
	description: ToolCallDescriptionSchema,
});

export type ListAgentsToolInput = Static<typeof ListAgentsToolInputSchema>;

export interface ListAgentsToolOptions {
	readonly getCoordinator: () => SubagentCoordinatorPort | undefined;
}

export function createListAgentsTool(options: ListAgentsToolOptions): RuntimeToolDefinition<ListAgentsToolInput> {
	return {
		name: "list_agents",
		label: "list_agents",
		description: LIST_AGENTS_TOOL_DESCRIPTION,
		inputSchema: ListAgentsToolInputSchema,
		async execute() {
			const coordinator = requireCoordinator(options);
			const agents = coordinator.list();
			const types = coordinator.registeredTypeIds();
			if (agents.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `No subagents yet. Registered types: ${types.join(", ") || "(none)"}.`,
						},
					],
					details: { agents: [], registeredTypes: types },
				};
			}
			const lines = agents.map(
				(agent) =>
					`- ${agent.path} id=${agent.id} type=${agent.agentType} status=${agent.status} task=${JSON.stringify(agent.task.slice(0, 120))}`,
			);
			return {
				content: [
					{
						type: "text",
						text: [`Registered types: ${types.join(", ")}`, "Agents:", ...lines].join("\n"),
					},
				],
				details: { agents, registeredTypes: types },
			};
		},
	};
}

function requireCoordinator(options: ListAgentsToolOptions): SubagentCoordinatorPort {
	const coordinator = options.getCoordinator();
	if (!coordinator) throw new Error("Subagents are not enabled for this session.");
	return coordinator;
}
