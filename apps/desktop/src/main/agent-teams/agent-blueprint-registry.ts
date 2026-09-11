import type { AgentBlueprint } from "@vetta/agent-team";
import type { PluginAgentPreset, PluginTeamPreset } from "./plugin-agent-presets.js";

/**
 * 宿主的 blueprint 解析入口。
 *
 * 宿主自己不带任何人设：blueprint 全部来自扩展，随扩展装卸。领域包刻意不知道扩展的存在
 * （它同时跑在渲染进程里，也不该依赖插件目录），所以装配只发生在主进程这一层。解析不到 =
 * 提供方当前不可用，调用方一律降级，不要抛错。
 */
class AgentBlueprintRegistry {
	private pluginAgents: readonly PluginAgentPreset[] = [];
	private pluginTeams: readonly PluginTeamPreset[] = [];
	private byId: ReadonlyMap<string, AgentBlueprint> = new Map();
	private byLegacyId: ReadonlyMap<string, AgentBlueprint> = new Map();
	private enabledPlugins: readonly string[] = [];

	/** 插件集合变化时整体替换：增量维护容易漏掉禁用/卸载，代价却只是重建一张小表。 */
	replacePluginPresets(
		agents: readonly PluginAgentPreset[],
		teams: readonly PluginTeamPreset[],
		enabledPlugins: readonly string[] = [],
	): void {
		this.pluginAgents = agents;
		this.pluginTeams = teams;
		this.enabledPlugins = enabledPlugins;
		this.byId = new Map(agents.map((preset) => [preset.blueprint.id, preset.blueprint]));
		this.byLegacyId = new Map(
			agents.flatMap((preset) => preset.legacyBlueprintIds.map((legacy) => [legacy, preset.blueprint] as const)),
		);
	}

	/**
	 * 当前全局启用的插件 id，随插件变更一起刷新。
	 *
	 * 放在这里是为了让能力折算不必反向 import 插件目录——那条边会把 electron-log 和整个
	 * 目录拖进每个引用它的模块。
	 */
	listEnabledPlugins(): readonly string[] {
		return this.enabledPlugins;
	}

	/**
	 * 先按 blueprint id 查，再按提供方声明的历史 id 折算。
	 *
	 * 后一档是给存量档案的：人设换了提供方之后，老档案里写的还是老 id。映射由提供方在自己的
	 * manifest 里声明，宿主因此不必知道谁接管了哪个角色。
	 */
	resolve(id: string): AgentBlueprint | undefined {
		return this.byId.get(id) ?? this.byLegacyId.get(id);
	}

	list(): readonly AgentBlueprint[] {
		return this.pluginAgents.map((preset) => preset.blueprint);
	}

	listPluginAgents(): readonly PluginAgentPreset[] {
		return this.pluginAgents;
	}

	listPluginTeams(): readonly PluginTeamPreset[] {
		return this.pluginTeams;
	}
}

export const agentBlueprintRegistry = new AgentBlueprintRegistry();

/** Blueprint 钉死的插件能力；没有钉死项时返回 undefined。 */
export function pinnedAbilityContext(
	blueprint: { readonly pinnedPlugins?: readonly string[] } | undefined,
): { readonly plugins: readonly string[] } | undefined {
	const plugins = blueprint?.pinnedPlugins ?? [];
	return plugins.length > 0 ? { plugins } : undefined;
}

/** 当前可用的 blueprint。找不到即视为提供方不可用。 */
export function resolveAgentBlueprint(id: string): AgentBlueprint | undefined {
	return agentBlueprintRegistry.resolve(id);
}
