import type { ModelCallContributionContext } from "@vetta/runtime-core/kernel";
import type { CodingAgentToolActivation } from "../runtime-contracts/index.js";

export interface CodingAgentToolAvailability {
	readonly backgroundTasksAvailable: boolean;
	readonly knowledgeAvailable: boolean;
}

/** 解析单次模型调用实际使用的工具激活状态，不持有 Registry 或 Session 状态。 */
export function resolveCodingAgentToolActivation(
	base: CodingAgentToolActivation,
	context: ModelCallContributionContext,
	availability: CodingAgentToolAvailability,
	activeToolNamesOverride?: readonly string[],
): CodingAgentToolActivation {
	if (activeToolNamesOverride) return { mode: "explicit", toolNames: [...activeToolNamesOverride] };
	if (base.mode === "explicit") return base;
	const capabilities = new Set(base.capabilities);
	if (availability.backgroundTasksAvailable) capabilities.add("bg-tasks");
	if (isCodingAgentKnowledgeToolEnabled(base, context, availability.knowledgeAvailable)) {
		capabilities.add("knowledge");
	}
	return { ...base, capabilities };
}

export function isCodingAgentKnowledgeToolEnabled(
	base: CodingAgentToolActivation,
	context: ModelCallContributionContext,
	knowledgeAvailable: boolean,
): boolean {
	if (!knowledgeAvailable) return false;
	return (
		(base.mode === "scope" && base.scope === "kb-processing") ||
		context.input?.context?.some(({ type }) => type === "knowledge_mode_instruction") === true ||
		isKnowledgeModeRequest(context.request?.payload)
	);
}

function isKnowledgeModeRequest(payload: unknown): boolean {
	if (!payload || typeof payload !== "object") return false;
	const metadata = Reflect.get(payload, "metadata");
	return Boolean(metadata && typeof metadata === "object" && Reflect.get(metadata, "knowledgeMode") === true);
}
