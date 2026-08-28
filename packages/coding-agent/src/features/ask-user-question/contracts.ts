import { defineSessionExtensionFunction } from "@vetta/runtime-core/session-extensions";

export const CODING_AGENT_ASK_USER_QUESTION_EXTENSION_ID = "coding-agent.ask-user-question";

export interface CodingAgentQuestionOption {
	readonly label: string;
	readonly description: string;
	readonly badges?: readonly string[];
}

export interface CodingAgentQuestionItem {
	readonly question: string;
	readonly header: string;
	readonly options: readonly CodingAgentQuestionOption[];
	readonly multiSelect?: boolean;
}

export interface CodingAgentQuestionRequest {
	readonly questions: readonly CodingAgentQuestionItem[];
}

export interface CodingAgentQuestionFunctionRequest extends CodingAgentQuestionRequest {
	readonly requestId: string;
	readonly sessionId: string;
}

export interface CodingAgentQuestionAnswer {
	readonly question: string;
	readonly answers: readonly string[];
}

export interface CodingAgentQuestionResult {
	readonly cancelled: boolean;
	readonly answers: readonly CodingAgentQuestionAnswer[];
}

export const CODING_AGENT_ASK_USER_QUESTION_FUNCTION = defineSessionExtensionFunction<
	CodingAgentQuestionFunctionRequest,
	CodingAgentQuestionResult
>(CODING_AGENT_ASK_USER_QUESTION_EXTENSION_ID, "request");
