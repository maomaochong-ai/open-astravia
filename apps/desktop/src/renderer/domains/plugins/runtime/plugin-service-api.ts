import type { Disposable, PluginServiceApi } from "@astravia-org/plugin-sdk";
import type { InstalledPlugin } from "@preload/api";

export function createPluginServiceApi(
	plugin: InstalledPlugin,
	capabilitySessionId: string,
	disposers: Array<() => void>,
): PluginServiceApi {
	let active = true;
	// 先关闭 API 门面，即使后续某个本地 disposer 失败也不能让旧 activation 继续跨 IPC 调用。
	disposers.unshift(() => {
		active = false;
	});
	const assertActive = (): void => {
		if (!active) throw activationAbortError();
	};
	const invoke = <T>(operation: () => Promise<T>): Promise<T> => {
		if (!active) return Promise.reject(activationAbortError());
		return operation();
	};
	const assertDeclared = (serviceId: string): string => {
		if (!plugin.serviceProviders?.some((service) => service.id === serviceId)) {
			throw new Error(`Plugin ${plugin.id} service not declared: ${serviceId}`);
		}
		return serviceId;
	};
	return {
		getPlatform: () => invoke(() => window.astravia.plugins.getServicePlatform(capabilitySessionId)),
		getStatus: (serviceId) =>
			invoke(() => window.astravia.plugins.getServiceStatus(capabilitySessionId, assertDeclared(serviceId))),
		install: (serviceId, artifacts) =>
			invoke(() =>
				window.astravia.plugins.installService(capabilitySessionId, assertDeclared(serviceId), artifacts),
			),
		start: (serviceId) =>
			invoke(() => window.astravia.plugins.startService(capabilitySessionId, assertDeclared(serviceId))),
		stop: (serviceId) =>
			invoke(() => window.astravia.plugins.stopService(capabilitySessionId, assertDeclared(serviceId))),
		restart: (serviceId) =>
			invoke(() => window.astravia.plugins.restartService(capabilitySessionId, assertDeclared(serviceId))),
		connection: (serviceId, credentialId) =>
			invoke(() =>
				window.astravia.plugins.getServiceConnection(capabilitySessionId, assertDeclared(serviceId), credentialId),
			),
		request: (serviceId, request) =>
			invoke(() => window.astravia.plugins.requestService(capabilitySessionId, assertDeclared(serviceId), request)),
		readDataFile: (serviceId, path, encoding) =>
			invoke(() =>
				window.astravia.plugins.readServiceDataFile(capabilitySessionId, assertDeclared(serviceId), path, encoding),
			),
		writeDataFile: (serviceId, path, data, encoding) =>
			invoke(() =>
				window.astravia.plugins.writeServiceDataFile(
					capabilitySessionId,
					assertDeclared(serviceId),
					path,
					data,
					encoding,
				),
			),
		reportReady: (serviceId, ready) =>
			invoke(() =>
				window.astravia.plugins.reportServiceReady(capabilitySessionId, assertDeclared(serviceId), ready),
			),
		onStatusChange: (listener): Disposable => {
			assertActive();
			const unsubscribe = window.astravia.plugins.onServiceStatusChanged((event) => {
				if (event.pluginId === plugin.id) listener(event.status);
			});
			disposers.push(unsubscribe);
			return { dispose: unsubscribe };
		},
	};
}

function activationAbortError(): Error {
	const error = new Error("Plugin activation is no longer active");
	error.name = "AbortError";
	return error;
}
