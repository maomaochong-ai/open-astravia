import type { AgentFeatureDefinition, ModelCallContributionProvider } from "@vetta/runtime-core/kernel";
import { type AskUserQuestionCapability, createAskUserQuestionToolRegistration } from "@vetta/runtime-tools/coding";
import type { ConversationScenario } from "../../profiles/index.js";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";

export const CODING_AGENT_ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";

export interface CodingAgentAskUserQuestionFeatureOptions {
	readonly capability: AskUserQuestionCapability;
	readonly scenario: ConversationScenario;
}

/**
 * 在每次模型调用前读取宿主提问能力，避免把动态 handler 固化进 Session 快照。
 */
export function createCodingAgentAskUserQuestionFeature(
	options: CodingAgentAskUserQuestionFeatureOptions,
): AgentFeatureDefinition {
	const tool = createAskUserQuestionToolRegistration({
		ask: (request, signal) => options.capability.ask(request, signal),
		modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.askUserQuestion,
	}).tool;
	return {
		id: "coding-agent.ask-user-question",
		async prepare(context) {
			context.signal.throwIfAborted();
			const provider: ModelCallContributionProvider = {
				id: "coding-agent.ask-user-question",
				async contribute(callContext) {
					callContext.signal.throwIfAborted();
					return isCodingAgentAskUserQuestionEnabled(options) ? { tools: [tool] } : {};
				},
			};
			return {
				async contribute(contributionContext) {
					contributionContext.signal.throwIfAborted();
					return { modelCallProviders: [provider] };
				},
				async dispose() {},
			};
		},
	};
}

export function isCodingAgentAskUserQuestionEnabled(options: CodingAgentAskUserQuestionFeatureOptions): boolean {
	return (options.scenario === "conversation" || options.scenario === "project") && options.capability.isEnabled();
}
