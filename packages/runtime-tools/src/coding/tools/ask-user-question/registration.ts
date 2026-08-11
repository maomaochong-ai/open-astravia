import type { CodingToolRegistration, CodingToolScope } from "../../tool-registration.js";
import {
	type AskUserQuestionToolInput,
	type AskUserQuestionToolOptions,
	createAskUserQuestionTool,
} from "./ask-user-question-tool.js";

export const ASK_USER_QUESTION_TOOL_SCOPES = ["conversation", "project"] as const satisfies readonly CodingToolScope[];
export const ASK_USER_QUESTION_TOOL_REQUIRES = ["host:ask"] as const;
export const ASK_USER_QUESTION_TOOL_CATEGORY = "agent-control" as const;

export interface AskUserQuestionToolRegistrationOptions extends AskUserQuestionToolOptions {
	readonly modelOrder?: number;
}

export function createAskUserQuestionToolRegistration(
	options: AskUserQuestionToolRegistrationOptions,
): CodingToolRegistration<AskUserQuestionToolInput> {
	const tool = createAskUserQuestionTool(options);
	return {
		tool: { ...tool, modelOrder: options.modelOrder },
		scopeUse: ASK_USER_QUESTION_TOOL_SCOPES,
		requires: ASK_USER_QUESTION_TOOL_REQUIRES,
		modelOrder: options.modelOrder,
		category: ASK_USER_QUESTION_TOOL_CATEGORY,
	};
}
