import type { InstalledPlugin, PluginPermission } from "../../preload/api-types/plugins.js";

const OFFICIAL_ONLY_PERMISSIONS = new Set<PluginPermission>([
	"agent.command.run",
	"agent.command.spawn",
	"browser.attach",
	"browser.runtime.manage",
]);

export function effectivePluginPermissions(
	permissions: readonly PluginPermission[],
	trustLevel: InstalledPlugin["trustLevel"],
): PluginPermission[] {
	return trustLevel === "official"
		? [...permissions]
		: permissions.filter((permission) => !OFFICIAL_ONLY_PERMISSIONS.has(permission));
}

export function effectivePluginCommands(
	commands: readonly string[],
	trustLevel: InstalledPlugin["trustLevel"],
): string[] {
	return trustLevel === "official" ? [...commands] : [];
}
