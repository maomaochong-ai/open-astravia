import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";

export function createOfficialWebhookApi(
	assertOfficial: () => void,
	capabilitySessionId: string,
): PluginOfficialApi["webhook"] {
	const webhook = window.vetta.plugins.internalCapabilities.webhook;
	return {
		list: async () => {
			assertOfficial();
			return webhook.listEndpoints(capabilitySessionId);
		},
		listProviders: async () => {
			assertOfficial();
			return webhook.listProviders(capabilitySessionId);
		},
		create: async (input) => {
			assertOfficial();
			return webhook.createEndpoint(capabilitySessionId, input);
		},
		update: async (id, input) => {
			assertOfficial();
			return webhook.updateEndpoint(capabilitySessionId, id, input);
		},
		setEnabled: async (id, enabled) => {
			assertOfficial();
			return webhook.setEnabled(capabilitySessionId, id, enabled);
		},
		delete: async (id) => {
			assertOfficial();
			await webhook.deleteEndpoint(capabilitySessionId, id);
		},
		test: async (id) => {
			assertOfficial();
			return webhook.testEndpoint(capabilitySessionId, id);
		},
		send: async (id, message) => {
			assertOfficial();
			return webhook.sendMessage(capabilitySessionId, id, message);
		},
	};
}
