import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { SubagentCoordinatorPort } from "@vetta/runtime-subagents";
import { ToolCallDescriptionSchema } from "../../shared/tool-call-description.js";
import { SEND_MESSAGE_TOOL_DESCRIPTION } from "./description.js";

export const SendMessageToolInputSchema = Type.Object({
	description: ToolCallDescriptionSchema,
	target: Type.String({ description: "Child id, task_name, or /root/<task_name>" }),
	message: Type.String({ description: "Constraint or context to inject; does not start a new turn by itself." }),
});

export type SendMessageToolInput = Static<typeof SendMessageToolInputSchema>;

export interface SendMessageToolOptions {
	readonly getCoordinator: () => SubagentCoordinatorPort | undefined;
}

export function createSendMessageTool(options: SendMessageToolOptions): RuntimeToolDefinition<SendMessageToolInput> {
	return {
		name: "send_message",
		label: "send_message",
		description: SEND_MESSAGE_TOOL_DESCRIPTION,
		inputSchema: SendMessageToolInputSchema,
		async execute({ input }) {
			const snapshot = await requireCoordinator(options).sendMessage(input.target, input.message);
			return {
				content: [{ type: "text", text: `Message queued for ${snapshot.id} (${snapshot.path}).` }],
				details: { ...snapshot },
			};
		},
	};
}

function requireCoordinator(options: SendMessageToolOptions): SubagentCoordinatorPort {
	const coordinator = options.getCoordinator();
	if (!coordinator) throw new Error("Subagents are not enabled for this session.");
	return coordinator;
}
