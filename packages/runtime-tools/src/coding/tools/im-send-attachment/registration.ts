import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import {
	createImSendAttachmentTool,
	type ImSendAttachmentToolInput,
	type ImSendAttachmentToolOptions,
} from "./im-send-attachment-tool.js";

export const IM_SEND_ATTACHMENT_TOOL_SCOPES = ["im-claw"] as const satisfies readonly CodingToolScope[];
export const IM_SEND_ATTACHMENT_TOOL_CATEGORY = "im" as const;

export interface ImSendAttachmentToolRegistrationOptions extends ImSendAttachmentToolOptions {
	readonly modelOrder?: number;
}

export function createImSendAttachmentToolRegistration(
	options: ImSendAttachmentToolRegistrationOptions,
): CodingToolRegistration<ImSendAttachmentToolInput> {
	const tool = createImSendAttachmentTool(options);
	return {
		tool: { ...tool, modelOrder: options.modelOrder },
		scopeUse: IM_SEND_ATTACHMENT_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: IM_SEND_ATTACHMENT_TOOL_CATEGORY,
	};
}
