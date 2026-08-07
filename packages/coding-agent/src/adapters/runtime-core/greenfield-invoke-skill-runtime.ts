import type { AgentFeatureDefinition, RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import { createInvokeSkillToolRegistration } from "@vetta/runtime-tools/coding";
import { matchesAgentMode } from "../../profiles/index.js";
import { readSkillContent, type Skill } from "../../resources/skills/index.js";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";
import { stripFrontmatter } from "../../utils/frontmatter.js";
import type { CodingAgentPromptResourceSource } from "./greenfield-prompt-runtime.js";

export interface CodingAgentInvokeSkillRuntimeFeatureOptions {
	readonly resourceSource: CodingAgentPromptResourceSource;
	readonly readAgentMode?: () => string | undefined;
}

export interface CodingAgentInvokeSkillRuntimeFeature extends AgentFeatureDefinition {
	readonly tool: RuntimeToolDefinition;
}

/**
 * Session 级动态 Skill 能力。
 *
 * 每个模型调用边界重新刷新资源；执行时再次解析当前可见 Skill，避免把已删除或已切换模式的
 * 本地 Skill 固化在 Session/Turn 之外的快照中。
 */
export function createCodingAgentInvokeSkillRuntimeFeature(
	options: CodingAgentInvokeSkillRuntimeFeatureOptions,
): CodingAgentInvokeSkillRuntimeFeature {
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
	const registration = createInvokeSkillToolRegistration({
		getSkills: readVisibleSkills,
		readBody: (skill) => stripFrontmatter(readSkillContent(skill)),
		modelOrder: CODING_AGENT_MODEL_TOOL_ORDER.invokeSkill,
	});

	return {
		id: "coding-agent.invoke-skill",
		tool: registration.tool,
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
