import { BatchTasksProjectApprovalView } from "./BatchTasksProjectApprovalView";
import { useBatchTasksProjectApprovalModel } from "./useBatchTasksProjectApprovalModel";

export function BatchTasksProjectApproval(): JSX.Element | null {
	const model = useBatchTasksProjectApprovalModel();
	if (!model) return null;
	return <BatchTasksProjectApprovalView key={model.approvalId} {...model} />;
}
