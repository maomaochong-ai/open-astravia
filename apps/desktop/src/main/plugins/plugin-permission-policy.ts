import type { PluginPermission } from "../../preload/api-types/plugins.js";

export function effectivePluginPermissions(permissions: readonly PluginPermission[]): PluginPermission[] {
	return [...new Set(permissions)];
}

export function effectivePluginCommands(commands: readonly string[]): string[] {
	return [...new Set(commands)];
}

export function grantDeclaredPluginCommands(
	current: readonly string[],
	requested: readonly string[],
	declared: readonly string[],
): string[] {
	const allowed = new Set(declared);
	return [...new Set([...current, ...requested.filter((name) => allowed.has(name))])];
}
