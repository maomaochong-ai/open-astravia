import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";

export function createOfficialUpdaterApi(
	assertOfficial: () => void,
	capabilitySessionId: string,
): PluginOfficialApi["updater"] {
	const updater = window.vetta.plugins.internalCapabilities.updater;
	return {
		getState: async () => {
			assertOfficial();
			return updater.getState(capabilitySessionId);
		},
		getCurrentVersion: async () => {
			assertOfficial();
			return updater.getCurrentVersion(capabilitySessionId);
		},
		check: async () => {
			assertOfficial();
			return updater.check(capabilitySessionId);
		},
		download: async () => {
			assertOfficial();
			return updater.download(capabilitySessionId);
		},
		install: async () => {
			assertOfficial();
			await updater.install(capabilitySessionId);
		},
		dismiss: async () => {
			assertOfficial();
			await updater.dismiss(capabilitySessionId);
		},
		cancel: async () => {
			assertOfficial();
			await updater.cancel(capabilitySessionId);
		},
	};
}
