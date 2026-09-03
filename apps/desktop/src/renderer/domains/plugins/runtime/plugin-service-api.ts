import type { InstalledPlugin } from "@preload/api";
import type { Disposable, PluginServiceApi } from "@vetta-org/plugin-sdk";

export function createPluginServiceApi(
	plugin: InstalledPlugin,
	capabilitySessionId: string,
	disposers: Array<() => void>,
): PluginServiceApi {
	const assertDeclared = (serviceId: string): string => {
		if (!plugin.serviceProviders?.some((service) => service.id === serviceId)) {
			throw new Error(`Plugin ${plugin.id} service not declared: ${serviceId}`);
		}
		return serviceId;
	};
	return {
		getPlatform: () => window.vetta.plugins.getServicePlatform(capabilitySessionId),
		getStatus: (serviceId) => window.vetta.plugins.getServiceStatus(capabilitySessionId, assertDeclared(serviceId)),
		install: (serviceId, artifacts) =>
			window.vetta.plugins.installService(capabilitySessionId, assertDeclared(serviceId), artifacts),
		start: (serviceId) => window.vetta.plugins.startService(capabilitySessionId, assertDeclared(serviceId)),
		stop: (serviceId) => window.vetta.plugins.stopService(capabilitySessionId, assertDeclared(serviceId)),
		restart: (serviceId) => window.vetta.plugins.restartService(capabilitySessionId, assertDeclared(serviceId)),
		connection: (serviceId, credentialId) =>
			window.vetta.plugins.getServiceConnection(capabilitySessionId, assertDeclared(serviceId), credentialId),
		request: (serviceId, request) =>
			window.vetta.plugins.requestService(capabilitySessionId, assertDeclared(serviceId), request),
		onStatusChange: (listener): Disposable => {
			const unsubscribe = window.vetta.plugins.onServiceStatusChanged((event) => {
				if (event.pluginId === plugin.id) listener(event.status);
			});
			disposers.push(unsubscribe);
			return { dispose: unsubscribe };
		},
	};
}
