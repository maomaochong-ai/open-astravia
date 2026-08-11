import type {
	PluginNetworkApi,
	PluginNetworkRequest,
	PluginNetworkResponse,
	PluginSettingsApi,
} from "@vetta-org/plugin-sdk";
import type { ContentProviderGenerationContext } from "../src/generation/types";

export function createGenerationContext(
	data: Record<string, { data: string; mimeType: string }> = {},
): ContentProviderGenerationContext {
	return {
		readReference: async (reference) => {
			const stored = data[reference.id];
			if (!stored) throw new Error(`missing reference fixture: ${reference.id}`);
			return stored;
		},
	};
}

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
