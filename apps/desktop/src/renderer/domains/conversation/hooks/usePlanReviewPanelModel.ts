import type {
	CodingAgentPlanReviewRequest,
	CodingAgentPlanReviewResult,
} from "@vetta/coding-agent/function-extensions";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { PlanReviewPanelLabels } from "../components/plan-review-panel/types";

export interface PlanReviewPanelModel {
	labels: PlanReviewPanelLabels;
	onApprove: (editedPlan?: string) => void;
	onRequestChanges: (feedback: string, editedPlan?: string) => void;
	onDismiss: () => void;
}

/**
 * 审批结论只回传给主进程；面板的收起由主进程广播的 resolved 事件驱动，
 * 这样远程端或中断解决同一请求时，本窗口的面板也会一致地消失。
 */
export function usePlanReviewPanelModel(pending: CodingAgentPlanReviewRequest): PlanReviewPanelModel {
	const { t } = useTranslation("chat");
	const respond = useCallback(
		(result: CodingAgentPlanReviewResult) => {
			void window.vetta.session.respondToPlanReview(pending.requestId, result).catch((error: unknown) => {
				console.error("[PlanReviewPanel] failed to send the review decision:", error);
			});
		},
		[pending.requestId],
	);

	const labels = useMemo<PlanReviewPanelLabels>(
		() => ({
			title: t("planMode.review.title"),
			subtitle: t("planMode.review.subtitle"),
			approve: t("planMode.review.approve"),
			requestChanges: t("planMode.review.requestChanges"),
			sendFeedback: (count) =>
				count > 0 ? t("planMode.review.sendFeedbackWithComments", { count }) : t("planMode.review.sendFeedback"),
			back: t("planMode.review.back"),
			dismiss: t("planMode.review.dismiss"),
			edit: t("planMode.review.edit"),
			doneEditing: t("planMode.review.doneEditing"),
			edited: t("planMode.review.edited"),
			resetEdits: t("planMode.review.resetEdits"),
			editorLabel: t("planMode.review.editorLabel"),
			feedbackLabel: t("planMode.review.feedbackLabel"),
			feedbackPlaceholder: t("planMode.review.feedbackPlaceholder"),
			commentOnStep: (number) => t("planMode.review.commentOnStep", { number }),
			stepCommentPlaceholder: t("planMode.review.stepCommentPlaceholder"),
		}),
		[t],
	);

	return {
		labels,
		onApprove: useCallback(
			(editedPlan) => respond(editedPlan ? { decision: "approve", plan: editedPlan } : { decision: "approve" }),
			[respond],
		),
		onRequestChanges: useCallback(
			(feedback, editedPlan) =>
				respond({ decision: "revise", feedback, ...(editedPlan ? { plan: editedPlan } : {}) }),
			[respond],
		),
		onDismiss: useCallback(() => respond({ decision: "cancelled" }), [respond]),
	};
}
