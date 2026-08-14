import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import { createSendMessageTool, type SendMessageToolInput, type SendMessageToolOptions } from "./send-message-tool.js";

export const SEND_MESSAGE_TOOL_SCOPES = [
	"conversation",
	"project",
	"cli",
] as const satisfies readonly CodingToolScope[];
export const SEND_MESSAGE_TOOL_CATEGORY = "agent-control" as const;

export interface SendMessageToolRegistrationOptions extends SendMessageToolOptions {
	readonly modelOrder?: number;
}

export function createSendMessageToolRegistration(
	options: SendMessageToolRegistrationOptions,
): CodingToolRegistration<SendMessageToolInput> {
	return {
		tool: { ...createSendMessageTool(options), modelOrder: options.modelOrder },
		scopeUse: SEND_MESSAGE_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: SEND_MESSAGE_TOOL_CATEGORY,
	};
}
