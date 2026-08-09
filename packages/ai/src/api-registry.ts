import { type ApiProvider, LegacyApiProviderRegistry, type RegisteredApiProvider } from "./runtime/adapter-registry.js";
import type { Api, StreamOptions } from "./types.js";

export type {
	ApiProvider,
	ApiStreamFunction,
	ApiStreamSimpleFunction,
	RegisteredApiProvider,
} from "./runtime/adapter-registry.js";
export { ApiProviderRegistrationError, LegacyApiProviderRegistry } from "./runtime/adapter-registry.js";

const defaultApiProviderRegistry = new LegacyApiProviderRegistry();

export function registerApiProvider<TApi extends Api, TOptions extends StreamOptions>(
	provider: ApiProvider<TApi, TOptions>,
	sourceId?: string,
): void {
	defaultApiProviderRegistry.register(provider, { sourceId, replace: true });
}

export function getApiProvider(api: Api): RegisteredApiProvider | undefined {
	return defaultApiProviderRegistry.get(api);
}

export function getApiProviders(): RegisteredApiProvider[] {
	return defaultApiProviderRegistry.getAll();
}

export function unregisterApiProviders(sourceId: string): void {
	defaultApiProviderRegistry.unregisterSource(sourceId);
}

export function clearApiProviders(): void {
	defaultApiProviderRegistry.clear();
}
