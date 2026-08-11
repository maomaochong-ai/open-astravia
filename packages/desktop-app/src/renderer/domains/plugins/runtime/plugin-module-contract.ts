import type { PluginDefinition } from "@vetta-org/plugin-sdk";

interface PluginModule {
	default?: PluginDefinition;
	activate?: PluginDefinition["activate"];
	deactivate?: PluginDefinition["deactivate"];
}

function assertPluginModule(value: unknown): PluginModule {
	if (value == null || typeof value !== "object") {
		throw new Error("Plugin module must export a plugin definition");
	}
	return value as PluginModule;
}

export function normalizePluginModule(value: unknown): PluginDefinition {
	const module = assertPluginModule(value);
	if (module.default) return module.default;
	if (module.activate) return { activate: module.activate, deactivate: module.deactivate };
	throw new Error("Plugin module must export default definePlugin(...) or activate()");
}

export function extractPluginReloadToken(entryUrl: string): string | null {
	try {
		const params = new URL(entryUrl).searchParams;
		return params.get("reload") ?? params.get("v");
	} catch {
		return null;
	}
}
