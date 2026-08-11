import { getAppLogger } from "../logger.js";
import { getSharedRuntime } from "../runtime.js";
import { summarizeAgentPluginRuntimeConfig } from "./plugin-runtime-config-builder.js";
import { buildAgentPluginRuntimeConfig } from "./plugin-store.js";

const pluginLog = getAppLogger("plugin");

/** Rebuild and apply the main-process Agent plugin snapshot after a plugin mutation. */
export function refreshAgentPlugins(): void {
	const config = buildAgentPluginRuntimeConfig();
	pluginLog.debug("refresh agent plugins", summarizeAgentPluginRuntimeConfig(config));
	getSharedRuntime().reconfigureAgentPlugins(config);
}
