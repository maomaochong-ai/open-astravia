import { defineSessionExtensionFunction } from "@vetta/runtime-core/session-extensions";
import type {
	CodingAgentQuestionRequest,
	CodingAgentQuestionResult,
} from "../../public-api/sdk/sdk-question-contract.js";

export type {
	CodingAgentQuestionAnswer,
	CodingAgentQuestionItem,
	CodingAgentQuestionOption,
	CodingAgentQuestionRequest,
	CodingAgentQuestionResult,
} from "../../public-api/sdk/sdk-question-contract.js";

export const CODING_AGENT_ASK_USER_QUESTION_EXTENSION_ID = "coding-agent.ask-user-question";

/**
 * PromptRequest.metadata 上的无人值守标记：宿主（如定时自动化）在没有人守着的轮次里置为 true，
 * 本轮不提供 ask_user_question，避免提问后无人应答把整轮挂住。只影响这一轮，不改会话能力。
 */
export const CODING_AGENT_UNATTENDED_TURN_METADATA_KEY = "unattended";

export interface CodingAgentQuestionFunctionRequest extends CodingAgentQuestionRequest {
	readonly requestId: string;
	readonly sessionId: string;
}

export const CODING_AGENT_ASK_USER_QUESTION_FUNCTION = defineSessionExtensionFunction<
	CodingAgentQuestionFunctionRequest,
	CodingAgentQuestionResult
>(CODING_AGENT_ASK_USER_QUESTION_EXTENSION_ID, "request");
