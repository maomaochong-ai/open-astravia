import type { CodingAgentToolInterceptor } from "../../interception/tool/contracts.js";
import type { PlanModeTurnBinding } from "./plan-mode-runtime.js";
import { evaluatePlanModeToolCall } from "./plan-mode-tool-policy.js";

/**
 * Plan 模式的执行闸门。工具面闸门让写工具不出现在 schema 里；这里兜住 schema 无法表达的部分
 * （命令内容、子 Agent 类型），并在工具面因任何原因漏出写工具时仍然拒绝执行。
 */
export function createPlanModeToolInterceptor(binding: PlanModeTurnBinding): CodingAgentToolInterceptor {
	return {
		async before({ tool, input }) {
			if (!binding.isPlanActive()) return undefined;
			const verdict = evaluatePlanModeToolCall(tool.name, input);
			return verdict.allowed ? undefined : { block: { reason: verdict.reason } };
		},
	};
}
