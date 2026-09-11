import type { AgentAbilitySelection } from "@vetta/agent-team";

export interface PinnedAbilityContext {
	/** Blueprint 强制随该智能体激活的插件。 */
	readonly plugins: readonly string[];
}

/**
 * 把 Agent Profile 的能力勾选折算成 Coding Agent 的配置覆盖。
 * `selectionMode === "all"` 返回空覆盖，表示继承全局启用的全部能力（含日后新装的），
 * 因此不能写成显式全集——那会把此后新增的能力挡在门外。
 *
 * blueprint 钉死的插件只在 `custom` 模式下并进显式清单。`all` 模式仍然返回空覆盖：
 * 配置合同里 `null` 是「跟随全局」、数组才是「就这些」，而「就这些」会被 agent 侧按
 * **有 agent 贡献的插件目录**校验——把全局启用集合展开成数组，里面的纯 UI 插件不在那份
 * 目录里，整个建会话会以 AGENT_CONFIGURATION_RESOURCE_UNAVAILABLE 失败。那份目录在
 * agent 运行时才装配得出来，这一层算不出正确的并集，所以不算。
 */
export function toAgentConfigurationOverrides(
	abilities: AgentAbilitySelection,
	pinned?: PinnedAbilityContext,
): {
	readonly skills?: string[];
	readonly mcpServers?: string[];
	readonly plugins?: string[];
} {
	const pinnedPlugins = pinned?.plugins ?? [];
	if (abilities.selectionMode === "all") return {};
	return {
		skills: [...abilities.skills],
		mcpServers: [...abilities.mcpServers],
		plugins: unique([...abilities.plugins, ...pinnedPlugins]),
	};
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}
