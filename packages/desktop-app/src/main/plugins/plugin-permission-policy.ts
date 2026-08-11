import type { InstalledPlugin, PluginPermission } from "../../preload/api-types/plugins.js";

const OFFICIAL_COMMAND_PERMISSIONS = new Set<PluginPermission>(["agent.command.run", "agent.command.spawn"]);

export function effectivePluginPermissions(
	permissions: readonly PluginPermission[],
	trustLevel: InstalledPlugin["trustLevel"],
): PluginPermission[] {
	return trustLevel === "official"
		? [...permissions]
		: permissions.filter((permission) => !OFFICIAL_COMMAND_PERMISSIONS.has(permission));
}

export function effectivePluginCommands(
	commands: readonly string[],
	trustLevel: InstalledPlugin["trustLevel"],
): string[] {
	return trustLevel === "official" ? [...commands] : [];
}
