import type { InstalledPlugin } from "@preload/api";
import type { PluginNetworkApi } from "@vetta-org/plugin-sdk";
import { normalizePluginNetworkRequest } from "./plugin-network-request";
import { createPluginPermissionApi } from "./plugin-permissions";

export function createPluginNetworkApi(plugin: InstalledPlugin, capabilitySessionId: string): PluginNetworkApi {
	const permissions = createPluginPermissionApi(plugin);
	return {
		request: (request) => {
			permissions.require("network.fetch");
			return window.vetta.plugins.networkRequest(capabilitySessionId, normalizePluginNetworkRequest(request));
		},
	};
}
