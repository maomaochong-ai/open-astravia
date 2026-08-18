import { BatchTasksExecutionApprovalView } from "./BatchTasksExecutionApprovalView";
import { useBatchTasksExecutionApprovalModel } from "./useBatchTasksExecutionApprovalModel";

export function BatchTasksExecutionApproval(): JSX.Element | null {
	const model = useBatchTasksExecutionApprovalModel();
	if (!model) return null;
	return <BatchTasksExecutionApprovalView key={model.approvalId} {...model} />;
}
