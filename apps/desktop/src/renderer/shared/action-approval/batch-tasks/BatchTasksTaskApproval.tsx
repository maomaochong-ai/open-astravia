import { BatchTasksTaskApprovalView } from "./BatchTasksTaskApprovalView";
import { useBatchTasksTaskApprovalModel } from "./useBatchTasksTaskApprovalModel";

export function BatchTasksTaskApproval(): JSX.Element | null {
	const model = useBatchTasksTaskApprovalModel();
	if (!model) return null;
	return <BatchTasksTaskApprovalView key={model.approvalId} {...model} />;
}
