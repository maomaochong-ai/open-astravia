import type { PluginOfficialApi } from "@astravia-org/plugin-sdk";

export function createOfficialDownloadsApi(
	assertOfficial: () => void,
	capabilitySessionId: string,
): PluginOfficialApi["downloads"] {
	const downloads = window.astravia.plugins.internalCapabilities.downloads;
	return {
		list: async () => {
			assertOfficial();
			return downloads.list(capabilitySessionId);
		},
		cancel: async (id) => {
			assertOfficial();
			await downloads.cancel(capabilitySessionId, id);
		},
	};
}
