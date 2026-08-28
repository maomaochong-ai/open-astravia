import type { ConversationScenario } from "../../../profiles/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../../../runtime-contracts/index.js";
import {
	createImSendAttachmentTool,
	type ImSendAttachmentToolInput,
	type ImSendAttachmentToolOptions,
} from "./im-send-attachment-tool.js";

export const IM_SEND_ATTACHMENT_TOOL_SCOPES = ["im-claw"] as const satisfies readonly ConversationScenario[];
export const IM_SEND_ATTACHMENT_TOOL_CATEGORY = "im" as const;

export interface ImSendAttachmentToolRegistrationOptions extends ImSendAttachmentToolOptions {
	readonly modelOrder?: number;
}

export function createImSendAttachmentToolRegistration(
	options: ImSendAttachmentToolRegistrationOptions,
): CodingAgentRuntimeToolRegistration<ImSendAttachmentToolInput> {
	const tool = createImSendAttachmentTool(options);
	return {
		tool: { ...tool, modelOrder: options.modelOrder },
		scopeUse: IM_SEND_ATTACHMENT_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: IM_SEND_ATTACHMENT_TOOL_CATEGORY,
		// 把本地文件外发到 IM 会话，消息发出即不可撤回，且工具自身没有确认对话框。
		sideEffect: "heavy",
	};
}
