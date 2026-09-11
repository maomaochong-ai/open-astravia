import { getAppLogger } from "../logger.js";
import { listPlugins, onPluginsChanged } from "../plugins/plugin-catalog.js";
import { agentBlueprintRegistry } from "./agent-blueprint-registry.js";
import { buildPluginAgentPresets } from "./plugin-agent-presets.js";

const log = getAppLogger("agent-teams");

let subscribed = false;

/** 按当前已启用的插件重建 blueprint 注册表。 */
export function refreshPluginAgentPresets(): void {
	try {
		const plugins = listPlugins();
		const { agents, teams } = buildPluginAgentPresets({ plugins, logger: log });
		agentBlueprintRegistry.replacePluginPresets(
			agents,
			teams,
			plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.id),
		);
		log.debug?.("plugin agent presets refreshed", { agents: agents.length, teams: teams.length });
	} catch (error) {
		// 读不出插件预设只该让插件智能体暂时缺席，不能连内置智能体一起拖垮。
		log.error("failed to refresh plugin agent presets", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/**
 * 建立「插件变更 → 重建 blueprint」的订阅，并立即跑一次。
 *
 * 必须早于第一次读 Agent 配置：装机目录回填要按当前可用的插件 blueprint 决定铺什么，
 * 注册表是空的就等于所有插件智能体都「不可用」。
 */
export function initPluginAgentPresetSync(): void {
	if (!subscribed) {
		subscribed = true;
		onPluginsChanged(refreshPluginAgentPresets);
	}
	refreshPluginAgentPresets();
}
