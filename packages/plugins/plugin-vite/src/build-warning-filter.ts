import type { Plugin, Rollup } from "vite";

const MODULE_LEVEL_DIRECTIVE_WARNING = "MODULE_LEVEL_DIRECTIVE";
const THIRD_PARTY_MODULE_PATH = /(?:^|\/)node_modules\//u;

export function isIgnorableThirdPartyClientDirective(warning: Rollup.RollupLog): boolean {
	if (warning.code !== MODULE_LEVEL_DIRECTIVE_WARNING || !warning.id) return false;
	const normalizedId = warning.id.replaceAll("\\", "/");
	return (
		THIRD_PARTY_MODULE_PATH.test(normalizedId) &&
		warning.message.includes("Module level directives cause errors when bundled") &&
		warning.message.includes('"use client"')
	);
}

/**
 * `use client` is React Server Components metadata. Plugin remotes are browser-only,
 * so Rollup intentionally discards the directive without changing runtime behavior.
 */
export function createPluginBuildWarningFilter(): Plugin {
	return {
		name: "vetta-plugin-build-warning-filter",
		apply: "build",
		onLog(level, log) {
			if (level === "warn" && isIgnorableThirdPartyClientDirective(log)) return false;
			return null;
		},
	};
}
