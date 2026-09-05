import { modelCatalog } from "@shared/store/model-catalog";
import type { PluginModelsApi, PluginPermissionApi } from "@vetta-org/plugin-sdk";

async function refreshLocalModelCatalog(): Promise<void> {
	await modelCatalog.revalidate({ force: true, sources: ["local"] });
}

export function createPluginModelsApi(permissions: PluginPermissionApi, capabilitySessionId: string): PluginModelsApi {
	return {
		upsertProvider: async (providerId, data) => {
			permissions.require("models.manage");
			await window.vetta.plugins.internalCapabilities.models.upsertOwnedProvider(
				capabilitySessionId,
				providerId,
				data,
			);
			await refreshLocalModelCatalog();
		},
		removeProvider: async (providerId) => {
			permissions.require("models.manage");
			await window.vetta.plugins.internalCapabilities.models.removeOwnedProvider(capabilitySessionId, providerId);
			await refreshLocalModelCatalog();
		},
	};
}
