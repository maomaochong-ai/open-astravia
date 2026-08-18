import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";

export function createOfficialMcpApi(
	assertOfficial: () => void,
	capabilitySessionId: string,
): PluginOfficialApi["mcp"] {
	const mcp = window.vetta.plugins.internalCapabilities.mcp;
	return {
		list: async () => {
			assertOfficial();
			return mcp.list(capabilitySessionId);
		},
		get: async (name) => {
			assertOfficial();
			return mcp.get(capabilitySessionId, name);
		},
		listNames: async () => {
			assertOfficial();
			return (await mcp.list(capabilitySessionId)).map((server) => server.name);
		},
		upsert: async (name, data) => {
			assertOfficial();
			return mcp.upsert(capabilitySessionId, name, data);
		},
		setEnabled: async (name, enabled) => {
			assertOfficial();
			await mcp.setEnabled(capabilitySessionId, name, enabled);
		},
		remove: async (name) => {
			assertOfficial();
			await mcp.remove(capabilitySessionId, name);
		},
	};
}
