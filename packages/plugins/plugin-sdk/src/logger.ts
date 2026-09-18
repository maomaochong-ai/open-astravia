import type { PluginLogFields, PluginLogger } from "./logging.js";

function unavailable(): never {
	throw new Error(
		"Plugin logger is not bound. Build this plugin with a compatible @vetta-org/plugin-vite release.",
	);
}

/**
 * Build-bound plugin logger.
 *
 * `@vetta-org/plugin-vite` replaces this module with a facade whose immutable
 * identity comes from the validated `plugin.json`. The fallback deliberately
 * fails on use so an unsupported build pipeline cannot emit unscoped logs.
 */
export const logger: PluginLogger = Object.freeze({
	debug: (_message: string, _fields?: PluginLogFields) => unavailable(),
	info: (_message: string, _fields?: PluginLogFields) => unavailable(),
	warn: (_message: string, _fields?: PluginLogFields) => unavailable(),
	error: (_message: string, _fields?: PluginLogFields) => unavailable(),
	child: (_scope: string) => unavailable(),
});

export type { PluginLogFields, PluginLogLevel, PluginLogger } from "./logging.js";
