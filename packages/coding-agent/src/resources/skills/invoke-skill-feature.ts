import type { EcosystemHookContributionSource, EcosystemHookRuntime } from "@vetta/ecosystem-adapter";
import type {
	AgentFeatureDefinition,
	ModelCallContributionProvider,
	RuntimeSnapshotAcquireContext,
	RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import { createInvokeSkillToolRegistration } from "@vetta/runtime-tools/coding";
import { sortByAgentModePreference } from "../../profiles/index.js";
import type { CodingAgentPromptResourceSource } from "../../runtime-contracts/prompt-runtime.js";
import { CODING_AGENT_MODEL_TOOL_ORDER } from "../../tool-policy/model-tool-order.js";
import { readSkillContent, type Skill } from "./index.js";
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
 * Session 级 Skill 能力。每个 Turn admission 捕获一次可见集合和正文；同一 Turn 的模型调用与
 * invoke_skill 执行共享该内存代，普通文件更新从下一 Turn 生效。
 */
export function createCodingAgentInvokeSkillFeature(
	options: CodingAgentInvokeSkillFeatureOptions,
): CodingAgentInvokeSkillFeature {
	const readVisibleSkills = (): Skill[] => {
		options.resourceSource.refreshSkillsIfChanged();
		const mode = options.readAgentMode?.();
		const invocable = options.resourceSource
			.getSkills()
			.skills.filter((skill) => !skill.disableModelInvocation && skill.type !== "scene");
		// agent_mode 是软引导：非本模式主推的 skill 依然可被模型调用，只是排在候选列表末尾。
		return sortByAgentModePreference(invocable, mode, (skill) => skill.agentMode);
	};
	const pendingActivations = new Map<string, EcosystemHookContributionSource>();
	const createRegistration = (getSkills: () => Skill[]) =>
		createInvokeSkillToolRegistration({
			getSkills,
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
	const registration = createRegistration(readVisibleSkills);
	const createProvider = (
		providerRegistration: ReturnType<typeof createInvokeSkillToolRegistration>,
		readSkills: () => Skill[],
	): ModelCallContributionProvider => ({
		id: "coding-agent.invoke-skill",
		bindForTurn(_context: RuntimeSnapshotAcquireContext) {
			const skills = captureVisibleSkills(readVisibleSkills());
			return createProvider(
				createRegistration(() => skills),
				() => skills,
			);
		},
		async contribute(contributionContext) {
			contributionContext.signal.throwIfAborted();
			return readSkills().length > 0 ? { tools: [providerRegistration.tool] } : {};
		},
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
					return { modelCallProviders: [createProvider(registration, readVisibleSkills)] };
				},
				async dispose() {},
			};
		},
	};
}

function captureVisibleSkills(skills: readonly Skill[]): Skill[] {
	return skills.map((skill) => ({
		...skill,
		agentMode: skill.agentMode ? [...skill.agentMode] : undefined,
		content: readSkillContent(skill),
	}));
}
