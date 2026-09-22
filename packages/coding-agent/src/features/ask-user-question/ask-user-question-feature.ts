import type { AgentFeatureDefinition, ModelCallContributionProvider } from "@vetta/runtime-core/kernel";
import { CODING_AGENT_UNATTENDED_TURN_METADATA_KEY } from "./contracts.js";
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
					if (isUnattendedRequest(callContext.request?.payload)) return {};
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

function isUnattendedRequest(payload: unknown): boolean {
	if (!payload || typeof payload !== "object") return false;
	const metadata = Reflect.get(payload, "metadata");
	return Boolean(
		metadata &&
			typeof metadata === "object" &&
			Reflect.get(metadata, CODING_AGENT_UNATTENDED_TURN_METADATA_KEY) === true,
	);
}
