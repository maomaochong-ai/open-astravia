import { SchedulerUpdateApprovalView } from "./SchedulerUpdateApprovalView";
import { useSchedulerUpdateApprovalModel } from "./useSchedulerUpdateApprovalModel";

export function SchedulerUpdateApproval(): JSX.Element | null {
	const model = useSchedulerUpdateApprovalModel();
	if (!model) return null;
	return <SchedulerUpdateApprovalView key={model.approvalId} {...model} />;
}
