import type { PluginModelsApi, PluginPermissionApi } from "@vetta-org/plugin-sdk";

export function createPluginModelsApi(permissions: PluginPermissionApi, capabilitySessionId: string): PluginModelsApi {
	return {
		replaceOwnedProviders: async (providers) => {
			permissions.require("models.manage");
			await window.vetta.plugins.internalCapabilities.models.replaceOwnedProviders(capabilitySessionId, providers);
		},
		listOwnedProviders: async () => {
			permissions.require("models.manage");
			const providers =
				await window.vetta.plugins.internalCapabilities.models.listOwnedProviders(capabilitySessionId);
			return Object.fromEntries(
				Object.entries(providers).map(([id, { models: sourceModels, ...provider }]) => [
					id,
					{
						...provider,
						...(sourceModels === undefined
							? {}
							: {
									models: sourceModels.map(({ input, ...model }) => {
										// Historical settings accept arbitrary strings; only return chat inputs
										// that the plugin write contract can round-trip on the next snapshot.
										const supported = input?.filter(
											(value): value is "text" | "image" => value === "text" || value === "image",
										);
										return { ...model, ...(supported?.length ? { input: [...new Set(supported)] } : {}) };
									}),
								}),
					},
				]),
			);
		},
	};
}
