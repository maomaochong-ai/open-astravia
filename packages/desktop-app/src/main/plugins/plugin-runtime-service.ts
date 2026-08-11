import { getAppLogger } from "../logger.js";
import { getSharedRuntime } from "../runtime.js";
import { pluginAgentContributionService } from "./plugin-catalog.js";
import { summarizeAgentPluginRuntimeConfig } from "./plugin-runtime-config-builder.js";

const pluginLog = getAppLogger("plugin");

/** Rebuild and apply the main-process Agent plugin snapshot after a plugin mutation. */
export function refreshAgentPlugins(): void {
	const config = pluginAgentContributionService.buildRuntimeConfig();
	pluginLog.debug("refresh agent plugins", summarizeAgentPluginRuntimeConfig(config));
	getSharedRuntime().reconfigureAgentPlugins(config);
}
