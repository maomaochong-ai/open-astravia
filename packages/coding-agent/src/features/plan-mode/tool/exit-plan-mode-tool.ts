import { type Static, Type } from "@sinclair/typebox";
import type { RuntimeToolDefinition } from "@vetta/runtime-core/kernel";
import type { CodingAgentPlanReviewResult } from "../contracts.js";
import { CODING_AGENT_EXIT_PLAN_MODE_TOOL_NAME } from "../plan-mode-tool-policy.js";
import { EXIT_PLAN_MODE_TOOL_DESCRIPTION } from "./description.js";

export const ExitPlanModeToolInputSchema = Type.Object({
	plan: Type.String({
		minLength: 1,
		description: "The complete implementation plan in Markdown, organised as numbered steps.",
	}),
});

export type ExitPlanModeToolInput = Static<typeof ExitPlanModeToolInputSchema>;

export interface ExitPlanModeToolDetails {
	readonly decision: CodingAgentPlanReviewResult["decision"];
	/** 审批后的定稿正文；仅 approve 时存在。 */
	readonly plan?: string;
}

/** 工具只依赖这个窄口：状态转换归 Plan Mode Runtime，审批交互归宿主 function。 */
export interface ExitPlanModePlanStore {
	submitPlan(content: string): void;
	requestChanges(content: string): void;
	dismissReview(content: string): void;
	approvePlan(content: string): void;
}

export interface ExitPlanModeToolOptions {
	readonly store: ExitPlanModePlanStore;
	readonly review: (
		request: { readonly sessionId: string; readonly plan: string },
		signal: AbortSignal,
	) => Promise<CodingAgentPlanReviewResult>;
	/** 批准后是否引导模型把计划步骤落成待办；取决于本会话 todo 工具是否可用。 */
	readonly isTodoToolAvailable: () => boolean;
	readonly modelOrder?: number;
}

export function createExitPlanModeTool(options: ExitPlanModeToolOptions): RuntimeToolDefinition<ExitPlanModeToolInput> {
	return {
		name: CODING_AGENT_EXIT_PLAN_MODE_TOOL_NAME,
		label: "Submit Plan",
		description: EXIT_PLAN_MODE_TOOL_DESCRIPTION,
		inputSchema: ExitPlanModeToolInputSchema,
		modelOrder: options.modelOrder,
		async execute({ input, sessionId, signal }) {
			const submitted = input.plan.trim();
			if (!submitted) {
				return textResult("The plan is empty. Write the full plan in Markdown and submit it again.", {
					decision: "revise",
				});
			}
			options.store.submitPlan(submitted);
			let result: CodingAgentPlanReviewResult;
			try {
				result = await options.review({ sessionId, plan: submitted }, signal);
			} catch (error) {
				// 中断或宿主故障：没有人做出决定，计划不能停留在「等待审批」。
				options.store.dismissReview(submitted);
				throw error;
			}
			const reviewed = result.decision === "cancelled" ? submitted : result.plan?.trim() || submitted;

			if (result.decision === "approve") {
				options.store.approvePlan(reviewed);
				return textResult(formatApproval(reviewed, reviewed !== submitted, options.isTodoToolAvailable()), {
					decision: "approve",
					plan: reviewed,
				});
			}
			if (result.decision === "revise") {
				options.store.requestChanges(reviewed);
				return textResult(formatRevision(result.feedback, reviewed, reviewed !== submitted), {
					decision: "revise",
				});
			}
			options.store.dismissReview(submitted);
			return textResult(
				"The user dismissed the plan review without deciding. Plan mode is still active and nothing may be changed. " +
					"Stop here and wait for the user's next message instead of resubmitting right away.",
				{ decision: "cancelled" },
			);
		},
	};
}

function formatApproval(plan: string, edited: boolean, todoAvailable: boolean): string {
	return [
		"The user approved the plan. Plan mode is off and all tools are available again — start executing now.",
		edited
			? "The user edited the plan before approving. The text below is authoritative; follow it, not your earlier draft."
			: undefined,
		todoAvailable
			? "Before the first change, record the plan's steps with the todo tool and keep their status current as you go."
			: undefined,
		"",
		"<approved_plan>",
		plan,
		"</approved_plan>",
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}

function formatRevision(feedback: string, plan: string, edited: boolean): string {
	return [
		"The user did not approve the plan and asked for changes. Plan mode is still active.",
		"Revise the plan to address every point below, doing more read-only research if needed, then submit it again.",
		"",
		"<user_feedback>",
		feedback.trim() || "(no written feedback — ask the user what should change)",
		"</user_feedback>",
		...(edited
			? [
					"",
					"The user also edited the plan text. Continue from their version:",
					"<edited_plan>",
					plan,
					"</edited_plan>",
				]
			: []),
	].join("\n");
}

function textResult(text: string, details: ExitPlanModeToolDetails) {
	return { content: [{ type: "text" as const, text }], details };
}
