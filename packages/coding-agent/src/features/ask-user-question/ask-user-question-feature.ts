import type { AgentFeatureDefinition, ModelCallContributionProvider } from "@vetta/runtime-core/kernel";
import { CODING_AGENT_ASK_USER_QUESTION_TOOL_NAME, createAskUserQuestionToolRegistration } from "./tool/index.js";

export { CODING_AGENT_ASK_USER_QUESTION_TOOL_NAME };

export interface CodingAgentAskUserQuestionFeatureOptions {
	readonly isEnabled: () => boolean;
	readonly ask: Parameters<typeof createAskUserQuestionToolRegistration>[0]["ask"];
	readonly modelOrder: number;
}

/** 在每次模型调用前读取宿主提问能力，避免把动态 handler 固化进 Session 快照。 */
export function createCodingAgentAskUserQuestionFeature(
	options: CodingAgentAskUserQuestionFeatureOptions,
): AgentFeatureDefinition {
	const tool = createAskUserQuestionToolRegistration({
		ask: options.ask,
		modelOrder: options.modelOrder,
	}).tool;
	return {
		id: "coding-agent.ask-user-question",
		async prepare(context) {
			context.signal.throwIfAborted();
			const provider: ModelCallContributionProvider = {
				id: "coding-agent.ask-user-question",
				async contribute(callContext) {
					callContext.signal.throwIfAborted();
					return options.isEnabled() ? { tools: [tool] } : {};
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
