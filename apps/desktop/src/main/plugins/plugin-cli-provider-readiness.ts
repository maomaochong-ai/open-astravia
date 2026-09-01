const readyProviders = new Set<string>();

function key(pluginId: string, providerId: string): string {
	return `${pluginId}:${providerId}`;
}

export function setPluginCliProviderReady(pluginId: string, providerId: string, ready: boolean): void {
	const providerKey = key(pluginId, providerId);
	if (ready) readyProviders.add(providerKey);
	else readyProviders.delete(providerKey);
}

export function clearPluginCliProviderReadiness(pluginId: string): void {
	for (const providerKey of readyProviders) {
		if (providerKey.startsWith(`${pluginId}:`)) readyProviders.delete(providerKey);
	}
}

export function arePluginCliProvidersReady(pluginId: string, providers: readonly { id: string }[]): boolean {
	return providers.every((provider) => readyProviders.has(key(pluginId, provider.id)));
}
