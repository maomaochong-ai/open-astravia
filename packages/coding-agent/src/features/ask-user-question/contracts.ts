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

export interface CodingAgentQuestionFunctionRequest extends CodingAgentQuestionRequest {
	readonly requestId: string;
	readonly sessionId: string;
}

export const CODING_AGENT_ASK_USER_QUESTION_FUNCTION = defineSessionExtensionFunction<
	CodingAgentQuestionFunctionRequest,
	CodingAgentQuestionResult
>(CODING_AGENT_ASK_USER_QUESTION_EXTENSION_ID, "request");
