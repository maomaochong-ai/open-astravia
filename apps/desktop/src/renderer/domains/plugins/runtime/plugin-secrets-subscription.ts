export interface PluginSecretsChangedPayload {
	readonly pluginId: string;
	readonly keys: readonly string[];
}

export interface PluginSecretsChangedHostApi {
	readonly onSecretsChanged?: (listener: (payload: PluginSecretsChangedPayload) => void) => () => void;
}

/**
 * Subscribe to secret changes when the preload exposes that optional API.
 * Older preload snapshots can still load plugins; they just cannot emit the
 * notification, so the returned disposer is a no-op in that case.
 */
export function subscribePluginSecretsChanged(
	hostApi: PluginSecretsChangedHostApi,
	pluginId: string,
	listener: (keys: readonly string[]) => void,
): () => void {
	const subscribe = hostApi.onSecretsChanged;
	if (typeof subscribe !== "function") return () => undefined;
	return subscribe((payload) => {
		if (payload.pluginId === pluginId) listener(payload.keys);
	});
}
