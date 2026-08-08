export type PluginNetworkBody =
	| {
			type: "json";
			value: unknown;
	  }
	| {
			type: "multipart";
			fields?: Record<string, string>;
			files?: Array<{
				fieldName: string;
				fileName: string;
				mimeType: string;
				data: string;
			}>;
	  };

export interface PluginNetworkRequest {
	url: string;
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	headers?: Record<string, string>;
	body?: PluginNetworkBody;
	responseType?: "json" | "text" | "base64";
	timeoutMs?: number;
}

export interface PluginNetworkResponse<T = unknown> {
	ok: boolean;
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: T;
}

/**
 * Host-mediated network access for trusted plugins.
 *
 * Requests run in the main process so plugins do not depend on renderer CORS
 * behavior. Access requires the `network.fetch` permission and a matching
 * `plugin.json` `network.allowedHosts` declaration.
 */
export interface PluginNetworkApi {
	request<T = unknown>(request: PluginNetworkRequest): Promise<PluginNetworkResponse<T>>;
}
