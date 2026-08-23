import type { PluginOfficialApi } from "@astravia-org/plugin-sdk";

export function createOfficialDialogApi(assertOfficial: () => void): PluginOfficialApi["dialog"] {
	return {
		openFiles: async (input) => {
			assertOfficial();
			return window.astravia.plugins.internalCapabilities.dialog.openFiles(input);
		},
	};
}
