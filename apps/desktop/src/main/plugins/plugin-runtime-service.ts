import { getAppLogger } from "../logger.js";
import { getSharedRuntime } from "../runtime.js";
import { pluginAgentContributionService } from "./plugin-catalog.js";
import { summarizeAgentPluginRuntimeConfig } from "./plugin-runtime-config-builder.js";
import {
	AgentPluginRuntimePublisher,
	type AgentPluginRuntimeRefreshOptions,
	type AgentPluginRuntimeRefreshResult,
} from "./plugin-runtime-publisher.js";

const pluginLog = getAppLogger("plugin");

const publisher = new AgentPluginRuntimePublisher({
	build: () => pluginAgentContributionService.buildRuntimeConfig(),
	apply: (config) => getSharedRuntime().reconfigureAgentPlugins(config),
	summarize: summarizeAgentPluginRuntimeConfig,
	logger: pluginLog,
});

/** Rebuild and publish the committed main-process Agent plugin snapshot. */
export function refreshAgentPlugins(options: AgentPluginRuntimeRefreshOptions = {}): AgentPluginRuntimeRefreshResult {
	return publisher.refresh(options);
}
