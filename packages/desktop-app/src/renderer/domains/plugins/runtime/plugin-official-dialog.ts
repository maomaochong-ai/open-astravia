import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";

export function createOfficialDialogApi(assertOfficial: () => void): PluginOfficialApi["dialog"] {
	return {
		saveCopy: (sourcePath, options) => {
			assertOfficial();
			return window.vetta.dialog.saveCopy(sourcePath, options);
		},
	};
}
