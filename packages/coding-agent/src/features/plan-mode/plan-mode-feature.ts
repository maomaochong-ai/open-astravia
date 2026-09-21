import type {
	AgentFeatureDefinition,
	ModelCallContributionProvider,
	RuntimeToolDefinition,
} from "@vetta/runtime-core/kernel";
import { PLAN_MODE_INSTRUCTION_ID, renderPlanModeInstructions } from "./plan-mode-instructions.js";
import type { PlanModeTurnBinding } from "./plan-mode-runtime.js";

export const PLAN_MODE_FEATURE_ID = "coding-agent.plan-mode";

/** 高于默认 Feature 指令，确保模式说明排在常规能力说明之后、贴近对话。 */
const PLAN_MODE_INSTRUCTION_PRIORITY = 900;

export interface CodingAgentPlanModeFeatureOptions {
	readonly bindForTurn: () => PlanModeTurnBinding;
	readonly canSubmitPlan: () => boolean;
	readonly exitTool: RuntimeToolDefinition;
}

/** Plan 模式的模型可见面：模式说明与 `exit_plan_mode`，只在闸门生效的模型调用里出现。 */
export function createCodingAgentPlanModeFeature(options: CodingAgentPlanModeFeatureOptions): AgentFeatureDefinition {
	const createProvider = (binding: PlanModeTurnBinding): ModelCallContributionProvider => ({
		id: PLAN_MODE_FEATURE_ID,
		bindForTurn: () => createProvider(options.bindForTurn()),
		async contribute(context) {
			context.signal.throwIfAborted();
			if (!binding.isPlanActive()) return {};
			const canSubmitPlan = options.canSubmitPlan();
			return {
				instructions: [
					{
						id: PLAN_MODE_INSTRUCTION_ID,
						content: renderPlanModeInstructions({ canSubmitPlan }),
						priority: PLAN_MODE_INSTRUCTION_PRIORITY,
					},
				],
				...(canSubmitPlan ? { tools: [options.exitTool] } : {}),
			};
		},
	});
	return {
		id: PLAN_MODE_FEATURE_ID,
		async prepare(context) {
			context.signal.throwIfAborted();
			return {
				async contribute(contributionContext) {
					contributionContext.signal.throwIfAborted();
					// 未经 Turn 绑定的调用读取实时状态；Turn 内由 bindForTurn 换成准入时的捕获。
					return { modelCallProviders: [createProvider(options.bindForTurn())] };
				},
				async dispose() {},
			};
		},
	};
}
