import type { McpServerConfig } from "@vetta/runtime-mcp";

export type DesktopMcpResourceScope = "application" | "workspace";
export type DesktopMcpConfigOrigin = "global" | "project";

/**
 * Global MCP entries are application resources unless they explicitly depend on the active project.
 * Project entries always remain workspace resources because their file location is part of their contract.
 */
export function resolveDesktopMcpServerResourceScope(
	origin: DesktopMcpConfigOrigin,
	config: McpServerConfig,
): DesktopMcpResourceScope {
	if (origin === "project") return "workspace";
	const configuredScope = readConfiguredResourceScope(config);
	if (configuredScope) return configuredScope;
	return containsProjectRootReference(config) ? "workspace" : "application";
}

function readConfiguredResourceScope(config: McpServerConfig): DesktopMcpResourceScope | undefined {
	const value = (config as McpServerConfig & { readonly resourceScope?: unknown }).resourceScope;
	return value === "application" || value === "workspace" ? value : undefined;
}

function containsProjectRootReference(config: McpServerConfig): boolean {
	return visitConfigValue(config, (value) => value.includes(`\${PROJECT_ROOT}`));
}

function visitConfigValue(value: unknown, predicate: (value: string) => boolean): boolean {
	if (typeof value === "string") return predicate(value);
	if (Array.isArray(value)) return value.some((entry) => visitConfigValue(entry, predicate));
	if (!value || typeof value !== "object") return false;
	return Object.values(value).some((entry) =>
		typeof entry === "function" ? false : visitConfigValue(entry, predicate),
	);
}
