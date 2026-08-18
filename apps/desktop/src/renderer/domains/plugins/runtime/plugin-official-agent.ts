import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";

export function createOfficialAgentApi(
	assertOfficial: () => void,
	capabilitySessionId: string,
): PluginOfficialApi["agent"] {
	const agentSettings = window.vetta.plugins.internalCapabilities.agentSettings;
	return {
		getExperimental: async () => {
			assertOfficial();
			return agentSettings.getExperimental(capabilitySessionId);
		},
		setExperimental: async (input) => {
			assertOfficial();
			return agentSettings.setExperimental(capabilitySessionId, input);
		},
	};
}
