import type { ModelCallContributionContext } from "@vetta/runtime-core/kernel";
import type { CodingToolActivation } from "@vetta/runtime-tools/coding";

export interface CodingAgentToolAvailability {
	readonly backgroundTasksAvailable: boolean;
	readonly knowledgeAvailable: boolean;
}

/** 解析单次模型调用实际使用的工具激活状态，不持有 Registry 或 Session 状态。 */
export function resolveCodingAgentToolActivation(
	base: CodingToolActivation,
	context: ModelCallContributionContext,
	availability: CodingAgentToolAvailability,
	/** 工作模式 slug；仅作为工具清单的排序/详略偏好透传，不参与激活过滤。 */
	agentMode?: string,
	activeToolNamesOverride?: readonly string[],
): CodingToolActivation {
	if (activeToolNamesOverride) return { mode: "explicit", toolNames: [...activeToolNamesOverride] };
	if (base.mode === "explicit") return base;
	const capabilities = new Set(base.capabilities);
	if (availability.backgroundTasksAvailable) capabilities.add("bg-tasks");
	if (isCodingAgentKnowledgeToolEnabled(base, context, availability.knowledgeAvailable)) {
		capabilities.add("knowledge");
	}
	return { ...base, capabilities, agentMode };
}

export function isCodingAgentKnowledgeToolEnabled(
	base: CodingToolActivation,
	context: ModelCallContributionContext,
	knowledgeAvailable: boolean,
): boolean {
	if (!knowledgeAvailable) return false;
	return (
		(base.mode === "scope" && base.scope === "kb-processing") ||
		context.input?.context?.some(({ type }) => type === "knowledge_mode_instruction") === true
	);
}
