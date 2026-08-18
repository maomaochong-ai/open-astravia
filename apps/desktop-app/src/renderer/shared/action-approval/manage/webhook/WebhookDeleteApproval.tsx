import { WebhookDeleteApprovalView } from "./WebhookDeleteApprovalView";
import { useWebhookDeleteApprovalModel } from "./useWebhookDeleteApprovalModel";

export function WebhookDeleteApproval(): JSX.Element | null {
	const model = useWebhookDeleteApprovalModel();
	if (!model) return null;
	return <WebhookDeleteApprovalView {...model} />;
}
