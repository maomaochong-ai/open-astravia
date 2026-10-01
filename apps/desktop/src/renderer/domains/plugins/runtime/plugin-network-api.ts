import type { PluginNetworkApi } from "@astravia-org/plugin-sdk";
import type { InstalledPlugin } from "@preload/api";
import { normalizePluginNetworkRequest } from "./plugin-network-request";
import { createPluginPermissionApi } from "./plugin-permissions";

export function createPluginNetworkApi(plugin: InstalledPlugin, capabilitySessionId: string): PluginNetworkApi {
	const permissions = createPluginPermissionApi(plugin);
	return {
		request: (request) => {
			permissions.require("network.fetch");
			return window.astravia.plugins.networkRequest(capabilitySessionId, normalizePluginNetworkRequest(request));
		},
	};
}
