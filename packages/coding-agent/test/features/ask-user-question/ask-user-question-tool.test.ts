import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { CodingToolRegistration } from "@vetta/runtime-tools";
import { describe, expect, it, vi } from "vitest";
import {
	ASK_USER_QUESTION_TOOL_CATEGORY,
	ASK_USER_QUESTION_TOOL_DESCRIPTION,
	ASK_USER_QUESTION_TOOL_REQUIRES,
	ASK_USER_QUESTION_TOOL_SCOPES,
	AskUserQuestionToolInputSchema,
	createAskUserQuestionToolRegistration,
} from "../../../src/features/ask-user-question/index.js";

const signal = new AbortController().signal;
const input = {
	description: "Clarify",
	questions: [
		{
			question: "Choose?",
			header: "Choice",
			options: [
				{ label: "First", description: "One" },
				{ label: "Second", description: "Two" },
			],
		},
	],
};

describe("Coding Agent ask_user_question tool", () => {
	it("owns the stable model-visible definition and registration metadata", () => {
		const registration = createAskUserQuestionToolRegistration({
			ask: async () => ({ cancelled: true, answers: [] }),
		});

		expectRegistration(registration, {
			name: "ask_user_question",
			label: "Ask User",
			description: ASK_USER_QUESTION_TOOL_DESCRIPTION,
			schema: AskUserQuestionToolInputSchema,
			scopeUse: ASK_USER_QUESTION_TOOL_SCOPES,
			requires: ASK_USER_QUESTION_TOOL_REQUIRES,
			category: ASK_USER_QUESTION_TOOL_CATEGORY,
		});
	});

	it("passes a normalized request to the host and preserves answer output", async () => {
		const ask = vi.fn(async () => ({
			cancelled: false,
			answers: [{ question: "Choose?", answers: ["First"] }],
		}));
		const runtime = createAskUserQuestionToolRegistration({ ask }).tool;

		expect(await executeRuntime(runtime, input)).toEqual({
			content: [
				{
					type: "text",
					text: 'User has answered your questions: "Choose?"="First". You can now continue with the user\'s answers in mind.',
				},
			],
			details: { cancelled: false, answers: [{ question: "Choose?", answers: ["First"] }] },
		});
		expect(ask).toHaveBeenCalledWith(
			{
				sessionId: "session",
				questions: [
					{
						question: "Choose?",
						header: "Choice",
						multiSelect: false,
						options: [
							{ label: "First", description: "One" },
							{ label: "Second", description: "Two" },
						],
					},
				],
			},
			signal,
		);
	});

	it("preserves the cancellation result and model guidance", async () => {
		const runtime = createAskUserQuestionToolRegistration({
			ask: async () => ({ cancelled: true, answers: [] }),
		}).tool;

		expect(await executeRuntime(runtime, input)).toEqual({
			content: [
				{
					type: "text",
					text: "User declined to answer the question(s). Decide how to proceed without their input.",
				},
			],
			details: { cancelled: true, answers: [] },
		});
	});
});

function expectRegistration<TInput extends object>(
	registration: CodingToolRegistration<TInput>,
	expected: {
		readonly name: string;
		readonly label: string;
		readonly description: string;
		readonly schema: Readonly<Record<string, unknown>>;
		readonly scopeUse: readonly string[];
		readonly requires?: readonly string[];
		readonly category: string;
	},
): void {
	expect({
		name: registration.tool.name,
		label: registration.tool.label,
		description: registration.tool.description,
		schema: registration.tool.inputSchema,
		scopeUse: registration.scopeUse,
		requires: registration.requires,
		category: registration.category,
	}).toEqual(expected);
}

async function executeRuntime<TInput extends object>(tool: RuntimeToolDefinition<TInput>, toolInput: TInput) {
	return tool.execute({
		sessionId: "session",
		turnId: "turn",
		toolCallId: "runtime",
		input: toolInput,
		signal,
	});
}
