import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { ToolCallDescriptionSchema } from "@vetta/runtime-tools/coding";
import type { CodingAgentQuestionAnswer, CodingAgentQuestionItem, CodingAgentQuestionResult } from "../contracts.js";
import { ASK_USER_QUESTION_TOOL_DESCRIPTION } from "./description.js";

export const CODING_AGENT_ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";
export const ASK_USER_QUESTION_HEADER_MAX = 24;

const AskUserQuestionOptionSchema = Type.Object({
	label: Type.String({
		description:
			"The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice.",
	}),
	description: Type.String({
		description:
			"Explanation of what this option means or what will happen if chosen. Useful for conveying trade-offs or implications.",
	}),
	badges: Type.Optional(
		Type.Array(Type.String(), {
			description:
				'Optional short tags rendered as badges on this option and used to signal your guidance. Use ["推荐"] (or "Recommended") to mark the option you recommend; you may add other short tags (e.g. "更快", "成本低"). Badges are display-only hints, not the answer.',
		}),
	),
});

const AskUserQuestionItemSchema = Type.Object({
	question: Type.String({
		description:
			'The complete question to ask the user. Should be clear, specific, and end with a question mark. If multiSelect is true, phrase it accordingly (e.g. "Which features do you want to enable?").',
	}),
	header: Type.String({
		description: `Very short label (max ${ASK_USER_QUESTION_HEADER_MAX} chars) shown as a chip/tag. Examples: "鉴权方式", "依赖库", "实现方案".`,
	}),
	options: Type.Array(AskUserQuestionOptionSchema, {
		minItems: 2,
		maxItems: 4,
		description:
			"The available choices. Must have 2-4 distinct, mutually-exclusive options (unless multiSelect is enabled). Do NOT add an 'Other' option — a free-text 'Other' input is always offered automatically.",
	}),
	multiSelect: Type.Optional(
		Type.Boolean({
			description:
				"Set true to let the user pick multiple options. Use when choices are not mutually exclusive. Default false.",
		}),
	),
});

export const AskUserQuestionToolInputSchema = Type.Object({
	description: ToolCallDescriptionSchema,
	questions: Type.Array(AskUserQuestionItemSchema, {
		minItems: 1,
		maxItems: 4,
		description:
			"Questions to ask the user (1-4). Put several related questions in one call rather than asking sequentially.",
	}),
});

export type AskUserQuestionToolInput = Static<typeof AskUserQuestionToolInputSchema>;
export type AskUserQuestionOption = AskUserQuestionToolInput["questions"][number]["options"][number];
export type AskUserQuestionItem = AskUserQuestionToolInput["questions"][number];
export type AskUserQuestionRequest = {
	readonly sessionId: string;
	readonly questions: readonly CodingAgentQuestionItem[];
};
export type AskUserQuestionAnswer = CodingAgentQuestionAnswer;
export type AskUserQuestionResult = CodingAgentQuestionResult;
export type AskUserQuestionFn = (
	request: AskUserQuestionRequest,
	signal?: AbortSignal,
) => Promise<CodingAgentQuestionResult>;
export type AskUserQuestionToolDetails = CodingAgentQuestionResult;

export interface AskUserQuestionToolOptions {
	readonly ask: AskUserQuestionFn;
}

export function createAskUserQuestionTool(
	options: AskUserQuestionToolOptions,
): RuntimeToolDefinition<AskUserQuestionToolInput> {
	return {
		name: CODING_AGENT_ASK_USER_QUESTION_TOOL_NAME,
		label: "Ask User",
		description: ASK_USER_QUESTION_TOOL_DESCRIPTION,
		inputSchema: AskUserQuestionToolInputSchema,
		async execute({ input, sessionId, signal }) {
			const result = await options.ask(
				{
					sessionId,
					questions: input.questions.map((question) => ({
						question: question.question,
						header: question.header,
						multiSelect: question.multiSelect ?? false,
						options: question.options.map((option) => ({ ...option })),
					})),
				},
				signal,
			);
			return {
				content: [{ type: "text", text: formatResultText(result) }],
				details: {
					cancelled: result.cancelled,
					answers: result.answers.map((answer) => ({ question: answer.question, answers: [...answer.answers] })),
				} satisfies AskUserQuestionToolDetails,
			};
		},
	};
}

function formatResultText(result: AskUserQuestionResult): string {
	if (result.cancelled || result.answers.length === 0) {
		return "User declined to answer the question(s). Decide how to proceed without their input.";
	}
	const parts = result.answers.map((answer) => `"${answer.question}"="${answer.answers.join(", ")}"`);
	return `User has answered your questions: ${parts.join(", ")}. You can now continue with the user's answers in mind.`;
}
