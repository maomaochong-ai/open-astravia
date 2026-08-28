import {
	defineSessionExtensionService,
	optionalSessionExtensionFunction,
	type SessionExtensionDefinition,
} from "@vetta/runtime-core/session-extensions";
import type { ConversationScenario } from "../../profiles/index.js";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";
import { createCodingAgentAskUserQuestionFeature } from "./ask-user-question-feature.js";
import { CODING_AGENT_ASK_USER_QUESTION_EXTENSION_ID, CODING_AGENT_ASK_USER_QUESTION_FUNCTION } from "./contracts.js";

export interface CodingAgentAskUserQuestionExtensionRuntime {
	isEnabled(): boolean;
}

export const CODING_AGENT_ASK_USER_QUESTION_RUNTIME =
	defineSessionExtensionService<CodingAgentAskUserQuestionExtensionRuntime>(
		CODING_AGENT_ASK_USER_QUESTION_EXTENSION_ID,
		"runtime",
	);

export interface CodingAgentAskUserQuestionSessionExtensionOptions {
	readonly scenario: ConversationScenario;
}

export function createCodingAgentAskUserQuestionSessionExtension(
	options: CodingAgentAskUserQuestionSessionExtensionOptions,
): SessionExtensionDefinition {
	return {
		id: CODING_AGENT_ASK_USER_QUESTION_EXTENSION_ID,
		functionDependencies: [optionalSessionExtensionFunction(CODING_AGENT_ASK_USER_QUESTION_FUNCTION)],
		create(context) {
			const runtime: CodingAgentAskUserQuestionExtensionRuntime = {
				isEnabled: () =>
					isSupportedScenario(options.scenario) && context.functions.has(CODING_AGENT_ASK_USER_QUESTION_FUNCTION),
			};
			return {
				contributions: [
					{ kind: "service", token: CODING_AGENT_ASK_USER_QUESTION_RUNTIME, value: runtime },
					{
						kind: "agent-feature",
						feature: createCodingAgentAskUserQuestionFeature({
							isEnabled: runtime.isEnabled,
							ask: async ({ sessionId, questions }, signal) =>
								context.functions.invoke(
									CODING_AGENT_ASK_USER_QUESTION_FUNCTION,
									{
										requestId: context.createId(),
										sessionId,
										questions,
									},
									signal,
								),
							modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.askUserQuestion,
						}),
					},
				],
				dispose() {},
			};
		},
	};
}

function isSupportedScenario(scenario: ConversationScenario): boolean {
	return scenario === "conversation" || scenario === "project";
}
