import type { PluginAiApi, PluginPermissionApi } from "@vetta-org/plugin-sdk";

export function createPluginAiApi(permissions: PluginPermissionApi, capabilitySessionId: string): PluginAiApi {
	const ai = window.vetta.plugins.internalCapabilities.ai;
	return {
		listModels: () => {
			permissions.require("ai.models.list");
			return ai.listModels(capabilitySessionId);
		},
		complete: (request) => {
			permissions.require("ai.complete");
			return ai.complete(capabilitySessionId, request);
		},
	};
}
