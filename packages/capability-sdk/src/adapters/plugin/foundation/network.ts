import {
	type CapabilityJsonValue,
	FOUNDATION_NETWORK_CAPABILITIES,
	parseCapabilityJsonValue,
} from "../../../foundation.js";
import { PLUGIN_CAPABILITY_PERMISSIONS, type PluginCapabilitySessionAccess } from "../types.js";

export const pluginNetworkMethods = {
	requestNetwork(
		this: PluginCapabilitySessionAccess,
		sessionId: string,
		request: unknown,
	): Promise<CapabilityJsonValue> {
		const session = this.session(sessionId, { permission: PLUGIN_CAPABILITY_PERMISSIONS.NETWORK_FETCH });
		return session.access.client.invoke(FOUNDATION_NETWORK_CAPABILITIES.REQUEST, {
			pluginId: session.pluginId,
			request: parseCapabilityJsonValue(request),
		});
	},
};

export type PluginNetworkMethods = typeof pluginNetworkMethods;
