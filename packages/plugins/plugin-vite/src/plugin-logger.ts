import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePluginManifest } from "@vetta-org/plugin-sdk/manifest";
import type { Plugin, ResolvedConfig } from "vite";

export const PLUGIN_LOGGER_MODULE_ID = "@vetta-org/plugin-sdk/logger";
export const VETTA_PLUGIN_LOGGER_MODULE_ID = "virtual:vetta-plugin-logger";
const RESOLVED_PLUGIN_LOGGER_MODULE_ID = `\0${VETTA_PLUGIN_LOGGER_MODULE_ID}`;

function readPluginIdentity(config: ResolvedConfig): { id: string; version: string } {
	const raw: unknown = JSON.parse(readFileSync(resolve(config.root, "plugin.json"), "utf8"));
	const manifest = parsePluginManifest(raw);
	return { id: manifest.id, version: manifest.version };
}

/** Bind the public logger subpath to the current plugin's validated manifest identity. */
export function createPluginLoggerBindingPlugin(): Plugin {
	let identity: { id: string; version: string } | undefined;
	return {
		name: "vetta-plugin-logger-binding",
		enforce: "pre",
		configResolved(config) {
			identity = readPluginIdentity(config);
		},
		resolveId(id) {
			if (id === PLUGIN_LOGGER_MODULE_ID || id === VETTA_PLUGIN_LOGGER_MODULE_ID) {
				return RESOLVED_PLUGIN_LOGGER_MODULE_ID;
			}
		},
		load(id) {
			if (id !== RESOLVED_PLUGIN_LOGGER_MODULE_ID) return;
			if (!identity) throw new Error("Plugin logger identity is unavailable before Vite config resolution");
			return `import { __createPluginLogger } from "@vetta-org/plugin-sdk";
export const logger = __createPluginLogger(${JSON.stringify(identity)});
`;
		},
	};
}
