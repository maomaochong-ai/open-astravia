import { WebhookEndpointListView, type WebhookEndpointRowView } from "@vetta/theme-ui/settings";
import type { WebhookSettingsModel } from "./useWebhookSettingsModel";

export function WebhookEndpointList({ model }: { model: WebhookSettingsModel }): JSX.Element {
	const endpoints: WebhookEndpointRowView[] = model.endpoints.map((endpoint) => {
		const provider = model.providerByKind.get(endpoint.kind);
		return {
			id: endpoint.id,
			name: endpoint.name,
			kind: endpoint.kind,
			kindDisplayName: provider?.displayName ?? endpoint.kind,
			iconClass: provider?.iconClass,
			urlMask: endpoint.urlMask ?? null,
			enabled: endpoint.enabled,
			hasSignSecret: Boolean(endpoint.hasSignSecret),
		};
	});

	return (
		<WebhookEndpointListView
			labels={model.labels}
			endpoints={endpoints}
			narrow={model.narrow}
			testingId={model.testingId}
			rowMessages={model.rowMessage}
			onToggle={(id, enabled) => {
				const endpoint = model.endpoints.find((e) => e.id === id);
				if (endpoint) void model.actions.toggleEndpoint(endpoint, enabled);
			}}
			onTest={(id) => {
				const endpoint = model.endpoints.find((e) => e.id === id);
				if (endpoint) void model.actions.testEndpoint(endpoint);
			}}
			onEdit={(id) => {
				const endpoint = model.endpoints.find((e) => e.id === id);
				if (endpoint) model.actions.openEdit(endpoint);
			}}
			onDelete={(id) => {
				const endpoint = model.endpoints.find((e) => e.id === id);
				if (endpoint) void model.actions.deleteEndpoint(endpoint);
			}}
		/>
	);
}
