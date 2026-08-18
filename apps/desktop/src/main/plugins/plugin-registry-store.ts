import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";
import { effectivePluginCommands, effectivePluginPermissions } from "./plugin-permission-policy.js";

export type PluginRegistry = Record<string, InstalledPlugin>;
export type SystemPluginPreferences = Record<string, { enabled: boolean; disabledCommands?: string[] }>;

export class PluginRegistryStore {
	constructor(
		private readonly path: string,
		private readonly pluginsBaseDir: string,
	) {}

	read(): PluginRegistry {
		if (!existsSync(this.path)) return {};
		try {
			const registry = JSON.parse(readFileSync(this.path, "utf-8")) as PluginRegistry;
			for (const plugin of Object.values(registry)) {
				plugin.runtime ??= "esm";
				plugin.allowedNetworkHosts ??= [];
				plugin.styleUrls ??= [];
				plugin.activeVersion ??= plugin.version;
				plugin.defaultLocale ??= "zh";
				plugin.locales ??= {};
				plugin.source ??= "archive";
				plugin.required = false;
				// The user-editable registry is not a trust root.
				plugin.trustLevel = plugin.source === "remote" || plugin.source === "npm" ? "community" : "local";
				if (plugin.source !== "npm") plugin.distribution = undefined;
				plugin.permissions = effectivePluginPermissions(plugin.permissions ?? [], plugin.trustLevel);
				plugin.grantedPermissions = effectivePluginPermissions(plugin.grantedPermissions ?? [], plugin.trustLevel);
				plugin.declaredCommands = effectivePluginCommands(plugin.declaredCommands ?? [], plugin.trustLevel);
				plugin.grantedCommandNames = effectivePluginCommands(plugin.grantedCommandNames ?? [], plugin.trustLevel);
				plugin.rootPath = join(this.pluginsBaseDir, plugin.id, "versions", plugin.activeVersion);
			}
			return registry;
		} catch {
			return {};
		}
	}

	write(registry: PluginRegistry): void {
		mkdirSync(dirname(this.path), { recursive: true });
		writeFileSync(this.path, JSON.stringify(registry, null, 2), "utf-8");
	}
}

export class SystemPluginPreferenceStore {
	constructor(private readonly path: string) {}

	read(): SystemPluginPreferences {
		if (!existsSync(this.path)) return {};
		try {
			return JSON.parse(readFileSync(this.path, "utf-8")) as SystemPluginPreferences;
		} catch {
			return {};
		}
	}

	write(preferences: SystemPluginPreferences): void {
		mkdirSync(dirname(this.path), { recursive: true });
		writeFileSync(this.path, JSON.stringify(preferences, null, 2), "utf-8");
	}
}
