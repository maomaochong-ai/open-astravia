import type { ConversationScenario } from "../../../profiles/index.js";
import type { CodingAgentRuntimeToolRegistration } from "../../../runtime-contracts/index.js";
import { createRecallTool, type RecallEntry, type RecallToolInput, type RecallToolOptions } from "./recall-tool.js";

/**
 * recall 的注册面：全场景可用（压缩可能发生在任何会话形态），category 归
 * context（与压缩同域）。readEntries 为必填——宿主不提供读取通道就不注册，
 * 模型界面零变化（不出现指向不存在能力的工具）。
 */

export const RECALL_TOOL_SCOPES = [
	"im-claw",
	"conversation",
	"project",
	"batch",
	"automation",
	"kb-processing",
	"cli",
] as const satisfies readonly ConversationScenario[];

/** 归 memory 域：与既有记忆类工具同组（读回会话历史即读回模型的记忆）。 */
export const RECALL_TOOL_CATEGORY = "memory" as const;

export interface RecallToolRegistrationOptions extends RecallToolOptions {
	readonly modelOrder?: number;
}

export function createRecallToolRegistration(
	options: RecallToolRegistrationOptions,
): CodingAgentRuntimeToolRegistration<RecallToolInput> {
	return {
		tool: { ...createRecallTool(options), modelOrder: options.modelOrder },
		scopeUse: RECALL_TOOL_SCOPES,
		modelOrder: options.modelOrder,
		category: RECALL_TOOL_CATEGORY,
	};
}

export type { RecallEntry };
