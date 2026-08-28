/** Stable question value contracts used by every Coding Agent host. */
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

export interface CodingAgentQuestionAnswer {
	readonly question: string;
	readonly answers: readonly string[];
}

export interface CodingAgentQuestionResult {
	readonly cancelled: boolean;
	readonly answers: readonly CodingAgentQuestionAnswer[];
}
