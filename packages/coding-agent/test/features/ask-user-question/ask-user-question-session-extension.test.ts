import type { ModelCallContributionContext, RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { SessionExtensionComposition, SessionExtensionFunctionRegistry } from "@vetta/runtime-core/session-extensions";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CODING_AGENT_ASK_USER_QUESTION_FUNCTION,
	CODING_AGENT_ASK_USER_QUESTION_RUNTIME,
	createCodingAgentAskUserQuestionSessionExtension,
} from "../../../src/features/ask-user-question/index.js";

const signal = new AbortController().signal;

describe("Coding Agent ask-user-question session extension", () => {
	const disposals: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		for (const dispose of disposals.splice(0).reverse()) await dispose();
	});

	it("tracks dynamic function availability at each model call and forwards request identity", async () => {
		const functions = new SessionExtensionFunctionRegistry();
		disposals.push(() => functions.close());
		const composition = await SessionExtensionComposition.create({
			createId: () => "question-request-1",
			functions,
			definitions: [createCodingAgentAskUserQuestionSessionExtension({ scenario: "conversation" })],
		});
		disposals.push(() => composition.dispose());
		const prepared = await composition.features[0]!.prepare({ signal });
		disposals.push(() => prepared.dispose());
		const contribution = await prepared.contribute({ signal });
		const provider = contribution.modelCallProviders?.[0];
		if (!provider) throw new Error("Expected ask-user-question model-call provider");

		expect(composition.services.require(CODING_AGENT_ASK_USER_QUESTION_RUNTIME).isEnabled()).toBe(false);
		expect(await readTool(provider.contribute.bind(provider))).toBeUndefined();

		const ask = vi.fn(async () => ({
			cancelled: false,
			answers: [{ question: "Choose?", answers: ["First"] }],
		}));
		const unregister = functions.register(CODING_AGENT_ASK_USER_QUESTION_FUNCTION, ask);
		expect(composition.services.require(CODING_AGENT_ASK_USER_QUESTION_RUNTIME).isEnabled()).toBe(true);
		const tool = await readTool(provider.contribute.bind(provider));
		if (!tool) throw new Error("Expected ask-user-question tool");

		await tool.execute({
			sessionId: "session-1",
			turnId: "turn-1",
			toolCallId: "call-1",
			input: {
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
			},
			signal,
		});
		expect(ask).toHaveBeenCalledWith(
			{
				requestId: "question-request-1",
				sessionId: "session-1",
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

		unregister();
		expect(await readTool(provider.contribute.bind(provider))).toBeUndefined();
	});

	it("does not expose an interaction tool in non-interactive product scenarios", async () => {
		const functions = new SessionExtensionFunctionRegistry();
		functions.register(CODING_AGENT_ASK_USER_QUESTION_FUNCTION, async () => ({ cancelled: true, answers: [] }));
		disposals.push(() => functions.close());
		const composition = await SessionExtensionComposition.create({
			functions,
			definitions: [createCodingAgentAskUserQuestionSessionExtension({ scenario: "cli" })],
		});
		disposals.push(() => composition.dispose());
		const prepared = await composition.features[0]!.prepare({ signal });
		disposals.push(() => prepared.dispose());
		const contribution = await prepared.contribute({ signal });
		const provider = contribution.modelCallProviders?.[0];
		if (!provider) throw new Error("Expected ask-user-question model-call provider");

		expect(await readTool(provider.contribute.bind(provider))).toBeUndefined();
	});
});

async function readTool(
	contribute: (
		context: ModelCallContributionContext,
	) => Promise<{ readonly tools?: readonly RuntimeToolDefinition[] }>,
): Promise<RuntimeToolDefinition | undefined> {
	const result = await contribute({ signal } as ModelCallContributionContext);
	return result.tools?.[0];
}
