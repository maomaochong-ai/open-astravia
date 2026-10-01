import type { PluginModelsApi, PluginPermissionApi } from "@astravia-org/plugin-sdk";

export function createPluginModelsApi(permissions: PluginPermissionApi, capabilitySessionId: string): PluginModelsApi {
	return {
		replaceOwnedProviders: async (providers) => {
			permissions.require("models.manage");
			await window.astravia.plugins.internalCapabilities.models.replaceOwnedProviders(
				capabilitySessionId,
				providers,
			);
		},
		listOwnedProviders: async () => {
			permissions.require("models.manage");
			return window.astravia.plugins.internalCapabilities.models.listOwnedProviders(capabilitySessionId);
		},
	};
}
