import type {
	PluginNetworkApi,
	PluginNetworkRequest,
	PluginNetworkResponse,
	PluginSettingsApi,
} from "@vetta-org/plugin-sdk";

export function createSettings(values: Record<string, unknown>): PluginSettingsApi {
	return {
		get: <T>(key: string) => values[key] as T | undefined,
		getAll: () => ({ ...values }),
		onChange: () => ({ dispose() {} }),
	};
}

export class QueueNetwork implements PluginNetworkApi {
	readonly requests: PluginNetworkRequest[] = [];

	constructor(private readonly responses: PluginNetworkResponse<unknown>[]) {}

	async request<T = unknown>(request: PluginNetworkRequest): Promise<PluginNetworkResponse<T>> {
		this.requests.push(request);
		const response = this.responses.shift();
		if (!response) throw new Error(`unexpected network request: ${request.url}`);
		return response as PluginNetworkResponse<T>;
	}
}

export function jsonResponse(body: unknown): PluginNetworkResponse<unknown> {
	return { ok: true, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, body };
}

export function base64Response(data: string, mimeType: string): PluginNetworkResponse<unknown> {
	return { ok: true, status: 200, statusText: "OK", headers: { "content-type": mimeType }, body: data };
}
