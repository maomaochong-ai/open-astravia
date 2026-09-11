import type { AgentBlueprint } from "@vetta/agent-team";
import { BUILTIN_AGENT_BLUEPRINTS, findAgentBlueprint } from "@vetta/agent-team";
import type { PluginAgentPreset, PluginTeamPreset } from "./plugin-agent-presets.js";

/**
 * 宿主的 blueprint 解析入口：内置的写死在 @vetta/agent-team 里，插件贡献的随插件装卸。
 *
 * 领域包刻意不知道插件的存在（它同时跑在渲染进程里，也不该依赖插件目录），所以合并只
 * 发生在主进程这一层。解析不到 = 该插件当前不可用，调用方一律降级，不要抛错。
 */
class AgentBlueprintRegistry {
	private pluginAgents: readonly PluginAgentPreset[] = [];
	private pluginTeams: readonly PluginTeamPreset[] = [];
	private byId: ReadonlyMap<string, AgentBlueprint> = new Map();
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

	resolve(id: string): AgentBlueprint | undefined {
		return findAgentBlueprint(id) ?? this.byId.get(id);
	}

	list(): readonly AgentBlueprint[] {
		return [...BUILTIN_AGENT_BLUEPRINTS, ...this.pluginAgents.map((preset) => preset.blueprint)];
	}

	listPluginAgents(): readonly PluginAgentPreset[] {
		return this.pluginAgents;
	}

	listPluginTeams(): readonly PluginTeamPreset[] {
		return this.pluginTeams;
	}
}

export const agentBlueprintRegistry = new AgentBlueprintRegistry();

/** Blueprint 钉死的插件能力，按当前全局启用集合展开；没有钉死项时返回 undefined。 */
export function pinnedAbilityContext(
	blueprint: { readonly pinnedPlugins?: readonly string[] } | undefined,
): { readonly plugins: readonly string[]; readonly enabledPlugins: readonly string[] } | undefined {
	const plugins = blueprint?.pinnedPlugins ?? [];
	if (plugins.length === 0) return undefined;
	return { plugins, enabledPlugins: agentBlueprintRegistry.listEnabledPlugins() };
}

/** 内置 + 当前已启用插件贡献的 blueprint。找不到即视为对应插件不可用。 */
export function resolveAgentBlueprint(id: string): AgentBlueprint | undefined {
	return agentBlueprintRegistry.resolve(id);
}
