import { registerBuiltInAdapters } from "../providers/register-builtins.js";
import { AdapterRegistry } from "./adapter-registry.js";

const defaultAdapterRegistry = new AdapterRegistry();
registerBuiltInAdapters(defaultAdapterRegistry);

export function getDefaultAdapterRegistry(): AdapterRegistry {
	return defaultAdapterRegistry;
}

export function resetDefaultAdapterRegistry(): void {
	defaultAdapterRegistry.clear();
	registerBuiltInAdapters(defaultAdapterRegistry);
}
