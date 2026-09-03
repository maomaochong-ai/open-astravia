import type { PluginModelsApi, PluginPermissionApi } from "@vetta-org/plugin-sdk";

export function createPluginModelsApi(permissions: PluginPermissionApi, capabilitySessionId: string): PluginModelsApi {
	return {
		upsertProvider: async (providerId, data) => {
			permissions.require("models.manage");
			await window.vetta.plugins.internalCapabilities.models.upsertOwnedProvider(
				capabilitySessionId,
				providerId,
				data,
			);
		},
		removeProvider: async (providerId) => {
			permissions.require("models.manage");
			await window.vetta.plugins.internalCapabilities.models.removeOwnedProvider(capabilitySessionId, providerId);
		},
	};
}
