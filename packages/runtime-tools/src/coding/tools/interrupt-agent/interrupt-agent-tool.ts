import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { SubagentCoordinatorPort } from "@vetta/runtime-subagents";
import { ToolCallDescriptionSchema } from "../../shared/tool-call-description.js";
import { INTERRUPT_AGENT_TOOL_DESCRIPTION } from "./description.js";

export const InterruptAgentToolInputSchema = Type.Object({
	description: ToolCallDescriptionSchema,
	target: Type.String({
		description: "Child id, task_name, or /root/<task_name>",
	}),
});

export type InterruptAgentToolInput = Static<typeof InterruptAgentToolInputSchema>;

export interface InterruptAgentToolOptions {
	readonly getCoordinator: () => SubagentCoordinatorPort | undefined;
}

export function createInterruptAgentTool(
	options: InterruptAgentToolOptions,
): RuntimeToolDefinition<InterruptAgentToolInput> {
	return {
		name: "interrupt_agent",
		label: "interrupt_agent",
		description: INTERRUPT_AGENT_TOOL_DESCRIPTION,
		inputSchema: InterruptAgentToolInputSchema,
		async execute({ input }) {
			const snapshot = requireCoordinator(options).interrupt(input.target);
			return {
				content: [
					{
						type: "text",
						text: `Subagent ${snapshot.id} (${snapshot.path}) status=${snapshot.status}`,
					},
				],
				details: { ...snapshot },
			};
		},
	};
}

function requireCoordinator(options: InterruptAgentToolOptions): SubagentCoordinatorPort {
	const coordinator = options.getCoordinator();
	if (!coordinator) throw new Error("Subagents are not enabled for this session.");
	return coordinator;
}
