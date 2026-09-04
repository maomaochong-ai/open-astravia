import type { PluginNetworkRequest } from "@vetta-org/plugin-sdk";

/** Keep the renderer-to-Capability payload JSON-compatible across Electron IPC. */
export function normalizePluginNetworkRequest(request: PluginNetworkRequest): PluginNetworkRequest {
	return {
		url: request.url,
		...(request.method === undefined ? {} : { method: request.method }),
		...(request.headers === undefined ? {} : { headers: request.headers }),
		...(request.body === undefined ? {} : { body: request.body }),
		...(request.responseType === undefined ? {} : { responseType: request.responseType }),
		...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
	};
}
