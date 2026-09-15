import { pluginBlueprintId } from "@vetta/agent-team";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";
import { getAppLogger } from "../logger.js";
import { listPlugins, onPluginsChanged } from "../plugins/plugin-catalog.js";
import { agentBlueprintRegistry } from "./agent-blueprint-registry.js";
import { agentTeamStore } from "./agent-team-store.js";
import { type PluginPresetDeclarations, pluginTeamId } from "./plugin-agent-preset-reconcile.js";
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
			collectPluginPresetDeclarations(plugins),
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
 * 收齐**已安装**插件声明过的预设标识——禁用的也算。
 *
 * 这是清理残骸唯一的判据：清单里不再声明的团队才该消失，用户临时禁用插件不该让它的资产被当成
 * 残骸清掉。历史 id 一并收进来，否则被接管过的存量资源会在下一次同步里被误判。
 */
export function collectPluginPresetDeclarations(plugins: readonly InstalledPlugin[]): PluginPresetDeclarations {
	const agentBlueprintIds = new Set<string>();
	const teamIds = new Set<string>();
	for (const plugin of plugins) {
		for (const agent of plugin.agent?.agents ?? []) {
			agentBlueprintIds.add(pluginBlueprintId(plugin.id, agent.id));
			for (const legacy of agent.legacyIds ?? []) agentBlueprintIds.add(legacy);
		}
		for (const team of plugin.agent?.teams ?? []) {
			teamIds.add(pluginTeamId(plugin.id, team.id));
			for (const legacy of team.legacyIds ?? []) teamIds.add(legacy);
		}
	}
	return { agentBlueprintIds, teamIds };
}

/**
 * 建立「插件变更 → 重建 blueprint → 重铺用户配置」的订阅，并立即跑一次。
 *
 * 必须早于第一次读 Agent 配置：装机目录回填要按当前可用的插件 blueprint 决定铺什么，
 * 注册表是空的就等于所有插件智能体都「不可用」。
 *
 * 第二步（重铺配置）不能省：注册表只是主进程的一张解析表，用户看到的智能体与团队来自已经读进
 * 内存的那份配置文档。热重载时只刷注册表，侧边栏会一直停在旧阵容直到重启 App。
 */
export function initPluginAgentPresetSync(): void {
	if (!subscribed) {
		subscribed = true;
		onPluginsChanged(() => {
			refreshPluginAgentPresets();
			void agentTeamStore.syncPluginPresets();
		});
	}
	refreshPluginAgentPresets();
}
