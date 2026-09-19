import { defineSessionExtensionFunction } from "@vetta/runtime-core/session-extensions";

export const CODING_AGENT_PLAN_MODE_EXTENSION_ID = "coding-agent.plan-mode";

/**
 * 会话级权限轴（ADR-0122）。与工作模式（任务先验，ADR-0071）和场景（scope_use）正交：
 * `plan` 是硬闸——模型调用的工具面收敛到只读集合，直到用户批准计划。
 */
export const CODING_AGENT_PERMISSION_MODES = ["default", "plan"] as const;
export type CodingAgentPermissionMode = (typeof CODING_AGENT_PERMISSION_MODES)[number];

export function isCodingAgentPermissionMode(value: unknown): value is CodingAgentPermissionMode {
	return typeof value === "string" && (CODING_AGENT_PERMISSION_MODES as readonly string[]).includes(value);
}

/** `dismissed`：审批被中断或关闭，没有人做出决定；闸门保持关闭。 */
export type CodingAgentPlanStatus = "pending-review" | "approved" | "changes-requested" | "dismissed";

export interface CodingAgentPlan {
	readonly content: string;
	readonly status: CodingAgentPlanStatus;
	/** ISO 时间戳；用于宿主展示「计划何时提交/批准」。 */
	readonly updatedAt: string;
}

export interface CodingAgentPlanModeState {
	readonly permissionMode: CodingAgentPermissionMode;
	/** 本会话最近一次提交审批的计划；从未提交过时缺省。 */
	readonly plan?: CodingAgentPlan;
}

export interface CodingAgentPlanReviewRequest {
	readonly requestId: string;
	readonly sessionId: string;
	readonly plan: string;
}

/**
 * 宿主对计划的审批结论。`plan` 为用户在审批面板里改过的正文；缺省表示沿用模型提交的版本。
 * `cancelled` 覆盖中断、窗口销毁等「没有人做决定」的情形，闸门保持关闭。
 */
export type CodingAgentPlanReviewResult =
	| { readonly decision: "approve"; readonly plan?: string }
	| { readonly decision: "revise"; readonly feedback: string; readonly plan?: string }
	| { readonly decision: "cancelled" };

export const CODING_AGENT_PLAN_REVIEW_FUNCTION = defineSessionExtensionFunction<
	CodingAgentPlanReviewRequest,
	CodingAgentPlanReviewResult
>(CODING_AGENT_PLAN_MODE_EXTENSION_ID, "review");
