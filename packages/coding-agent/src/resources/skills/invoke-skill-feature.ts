import type { EcosystemHookContributionSource, EcosystemHookRuntime } from "@vetta/ecosystem-adapter";
import type { AgentFeatureDefinition, RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { createInvokeSkillToolRegistration } from "@vetta/runtime-tools/coding";
import { matchesAgentMode } from "../../profiles/index.js";
import type { CodingAgentPromptResourceSource } from "../../runtime-contracts/prompt-runtime.js";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";
import type { Skill } from "./index.js";
import { createSkillHookContribution, readSkillInvocationDocument } from "./skill-document.js";

export interface CodingAgentInvokeSkillFeatureOptions {
	readonly resourceSource: CodingAgentPromptResourceSource;
	readonly readAgentMode?: () => string | undefined;
	readonly hookRuntime?: Pick<EcosystemHookRuntime, "registerCurrentTurnContribution">;
}

export interface CodingAgentInvokeSkillFeature extends AgentFeatureDefinition {
	readonly tool: RuntimeToolDefinition;
	wrapHookActivation(tools: ReadonlyMap<string, RuntimeToolDefinition>): ReadonlyMap<string, RuntimeToolDefinition>;
}

/**
 * Session 级动态 Skill 能力。
 *
 * 每个模型调用边界重新刷新资源；执行时再次解析当前可见 Skill，避免把已删除或已切换模式的
 * 本地 Skill 固化在 Session/Turn 之外的快照中。
 */
export function createCodingAgentInvokeSkillFeature(
	options: CodingAgentInvokeSkillFeatureOptions,
): CodingAgentInvokeSkillFeature {
	const readVisibleSkills = (): Skill[] => {
		options.resourceSource.refreshSkillsIfChanged();
		const mode = options.readAgentMode?.();
		return options.resourceSource
			.getSkills()
			.skills.filter(
				(skill) =>
					!skill.disableModelInvocation && skill.type !== "scene" && matchesAgentMode(skill.agentMode, mode),
			);
	};
	const pendingActivations = new Map<string, EcosystemHookContributionSource>();
	const registration = createInvokeSkillToolRegistration({
		getSkills: readVisibleSkills,
		readBody: (skill, request) => {
			const document = readSkillInvocationDocument(skill);
			const activation = createSkillHookContribution(skill, document);
			if (options.hookRuntime && activation) {
				pendingActivations.set(request.toolCallId, activation);
			} else {
				pendingActivations.delete(request.toolCallId);
			}
			return document.body;
		},
		modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.invokeSkill,
	});

	return {
		id: "coding-agent.invoke-skill",
		tool: registration.tool,
		wrapHookActivation(tools) {
			const tool = tools.get(registration.tool.name);
			if (!tool || !options.hookRuntime) return tools;
			const wrapped: RuntimeToolDefinition = {
				...tool,
				async execute(request) {
					try {
						const result = await tool.execute(request);
						const activation = pendingActivations.get(request.toolCallId);
						if (activation) await options.hookRuntime?.registerCurrentTurnContribution(activation);
						return result;
					} finally {
						pendingActivations.delete(request.toolCallId);
					}
				},
			};
			return new Map(tools).set(wrapped.name, wrapped);
		},
		async prepare(context) {
			context.signal.throwIfAborted();
			return {
				async contribute(contributionContext) {
					contributionContext.signal.throwIfAborted();
					return readVisibleSkills().length > 0 ? { tools: [registration.tool] } : {};
				},
				async dispose() {},
			};
		},
	};
}
