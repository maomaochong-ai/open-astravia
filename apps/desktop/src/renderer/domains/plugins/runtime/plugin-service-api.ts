import type { InstalledPlugin } from "@preload/api";
import type { Disposable, PluginServiceApi } from "@vetta-org/plugin-sdk";

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
		getPlatform: () => invoke(() => window.vetta.plugins.getServicePlatform(capabilitySessionId)),
		getStatus: (serviceId) =>
			invoke(() => window.vetta.plugins.getServiceStatus(capabilitySessionId, assertDeclared(serviceId))),
		install: (serviceId, artifacts) =>
			invoke(() => window.vetta.plugins.installService(capabilitySessionId, assertDeclared(serviceId), artifacts)),
		start: (serviceId) =>
			invoke(() => window.vetta.plugins.startService(capabilitySessionId, assertDeclared(serviceId))),
		stop: (serviceId) =>
			invoke(() => window.vetta.plugins.stopService(capabilitySessionId, assertDeclared(serviceId))),
		restart: (serviceId) =>
			invoke(() => window.vetta.plugins.restartService(capabilitySessionId, assertDeclared(serviceId))),
		connection: (serviceId, credentialId) =>
			invoke(() =>
				window.vetta.plugins.getServiceConnection(capabilitySessionId, assertDeclared(serviceId), credentialId),
			),
		request: (serviceId, request) =>
			invoke(() => window.vetta.plugins.requestService(capabilitySessionId, assertDeclared(serviceId), request)),
		readDataFile: (serviceId, path, encoding) =>
			invoke(() =>
				window.vetta.plugins.readServiceDataFile(capabilitySessionId, assertDeclared(serviceId), path, encoding),
			),
		writeDataFile: (serviceId, path, data, encoding) =>
			invoke(() =>
				window.vetta.plugins.writeServiceDataFile(
					capabilitySessionId,
					assertDeclared(serviceId),
					path,
					data,
					encoding,
				),
			),
		reportReady: (serviceId, ready) =>
			invoke(() => window.vetta.plugins.reportServiceReady(capabilitySessionId, assertDeclared(serviceId), ready)),
		onStatusChange: (listener): Disposable => {
			assertActive();
			const unsubscribe = window.vetta.plugins.onServiceStatusChanged((event) => {
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
