import { WebhookSettingsView } from "./WebhookSettingsView";
import { useWebhookSettingsModel } from "./useWebhookSettingsModel";

export function WebhookSettings(): JSX.Element {
	const model = useWebhookSettingsModel();
	return <WebhookSettingsView model={model} />;
}
