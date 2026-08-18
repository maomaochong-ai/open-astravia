import { WebhookTestApprovalView } from "./WebhookTestApprovalView";
import { useWebhookTestApprovalModel } from "./useWebhookTestApprovalModel";

export function WebhookTestApproval(): JSX.Element | null {
	const model = useWebhookTestApprovalModel();
	if (!model) return null;
	return <WebhookTestApprovalView {...model} />;
}
