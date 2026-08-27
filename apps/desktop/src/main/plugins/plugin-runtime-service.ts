import { getBuiltinSkillPaths } from "../builtin-skills.js";
import { getAppLogger } from "../logger.js";
import { DesktopCodingAgentPluginRuntimeSource } from "./coding-agent-plugin-runtime-source.js";
import { pluginAgentContributionService } from "./plugin-catalog.js";
import { summarizeAgentPluginRuntimeConfig } from "./plugin-runtime-config-builder.js";
import {
	AgentPluginRuntimePublisher,
	type AgentPluginRuntimeRefreshOptions,
	type AgentPluginRuntimeRefreshResult,
} from "./plugin-runtime-publisher.js";

const pluginLog = getAppLogger("plugin");

const runtimeSource = new DesktopCodingAgentPluginRuntimeSource({
	build: () => pluginAgentContributionService.buildRuntimeConfig(),
	additionalSkillPaths: getBuiltinSkillPaths(),
	handlerLeaseProvider: {
		bindForTurn: (agentPlugins) => pluginAgentContributionService.bindAgentHandlersForTurn(agentPlugins),
	},
});

const publisher = new AgentPluginRuntimePublisher({
	build: () => pluginAgentContributionService.buildRuntimeConfig(),
	apply: (config) => runtimeSource.publish(config),
	summarize: summarizeAgentPluginRuntimeConfig,
	logger: pluginLog,
});

/** Rebuild and publish the committed main-process Agent plugin snapshot. */
export function refreshAgentPlugins(options: AgentPluginRuntimeRefreshOptions = {}): AgentPluginRuntimeRefreshResult {
	return publisher.refresh(options);
}

export function getDesktopCodingAgentPluginRuntimeSource(): DesktopCodingAgentPluginRuntimeSource {
	return runtimeSource;
}
