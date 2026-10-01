import type { PluginOfficialApi } from "@astravia-org/plugin-sdk";

export function createOfficialGeneralApi(
	assertOfficial: () => void,
	capabilitySessionId: string,
): PluginOfficialApi["general"] {
	const generalSettings = window.astravia.plugins.internalCapabilities.generalSettings;
	return {
		getSettings: async () => {
			assertOfficial();
			return generalSettings.get(capabilitySessionId);
		},
		setSettings: async (input) => {
			assertOfficial();
			if (input.operation === "set-notifications") {
				const result = await generalSettings.setNotifications(capabilitySessionId, input.enabled);
				return { operation: input.operation, enabled: result.enabled };
			}
			if (input.operation === "set-execution-mode") {
				const result = await generalSettings.setDefaultExecutionMode(capabilitySessionId, input.mode);
				return { operation: input.operation, mode: result.mode };
			}
			if (input.operation === "set-workspace") {
				const result = await generalSettings.setWorkspace(capabilitySessionId, input.path);
				return { operation: input.operation, path: result.path };
			}
			throw new Error("Unsupported general settings operation");
		},
	};
}
