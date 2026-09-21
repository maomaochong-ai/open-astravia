import type { CodingAgentPlanReviewRequest } from "@vetta/coding-agent/function-extensions";
import { usePlanReviewPanelModel } from "../hooks/usePlanReviewPanelModel";
import { PlanReviewPanelView } from "./plan-review-panel/PlanReviewPanelView";

/** 连接层：把待审批请求与 i18n、IPC 应答接到纯展示的审批面板。 */
export function PlanReviewPanel({ pending }: { pending: CodingAgentPlanReviewRequest }): JSX.Element {
	const model = usePlanReviewPanelModel(pending);
	return (
		<PlanReviewPanelView
			// 同一会话被退回后再次提交是新的请求：重置面板内的编辑与意见草稿。
			key={pending.requestId}
			plan={pending.plan}
			labels={model.labels}
			onApprove={model.onApprove}
			onRequestChanges={model.onRequestChanges}
			onDismiss={model.onDismiss}
		/>
	);
}
