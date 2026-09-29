import type { InstalledPlugin } from "@preload/api";
import type { Disposable, PluginContext, PluginPermission } from "@vetta-org/plugin-sdk";
import { logPluginRuntimeWarn } from "./plugin-runtime-log";

export const noopDisposable: Disposable = { dispose: () => {} };

export function hasPluginPermission(plugin: InstalledPlugin, permission: PluginPermission): boolean {
	return plugin.permissions.includes(permission) && plugin.grantedPermissions.includes(permission);
}

export function createPluginPermissionApi(plugin: InstalledPlugin): PluginContext["permissions"] {
	return {
		has: (permission) => hasPluginPermission(plugin, permission),
		require: (permission) => {
			if (!hasPluginPermission(plugin, permission)) {
				throw new Error(`Plugin permission denied: ${permission}`);
			}
		},
	};
}

export function warnSkippedPluginContribution(
	plugin: InstalledPlugin,
	permission: PluginPermission,
	contribution: string,
): void {
	logPluginRuntimeWarn("contribution skipped", {
		pluginId: plugin.id,
		pluginVersion: plugin.activeVersion,
		stage: "permission-check",
		reason: "missing-permission",
		permission,
		contribution,
	});
}
