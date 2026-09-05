import type { PluginModelsApi, PluginPermissionApi } from "@vetta-org/plugin-sdk";

export function createPluginModelsApi(permissions: PluginPermissionApi, capabilitySessionId: string): PluginModelsApi {
	return {
		replaceOwnedProviders: async (providers) => {
			permissions.require("models.manage");
			await window.vetta.plugins.internalCapabilities.models.replaceOwnedProviders(capabilitySessionId, providers);
		},
	};
}
