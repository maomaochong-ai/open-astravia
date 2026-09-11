import type { AgentAbilitySelection } from "@vetta/agent-team";

export interface PinnedAbilityContext {
	/** Blueprint 强制随该智能体激活的插件，用户在能力面板里关不掉。 */
	readonly plugins: readonly string[];
	/** 当前全局启用的插件 id，用于在 `all` 模式下展开成显式集合。 */
	readonly enabledPlugins: readonly string[];
}

/**
 * 把 Agent Profile 的能力勾选折算成 Coding Agent 的配置覆盖。
 * `selectionMode === "all"` 返回空覆盖，表示继承全局启用的全部能力（含日后新装的），
 * 因此不能写成显式全集——那会把此后新增的能力挡在门外。
 *
 * 例外是 blueprint 钉死的插件：配置合同里 `null` 是「跟随全局」、数组才是「就这些」，
 * 没有「全局再加一个」的写法。所以一旦有钉死项，就在建会话这一刻把全局集合展开成显式
 * 数组再并上它。这是每次建会话现算的，新装的插件下一个会话就会进来。
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
	if (abilities.selectionMode === "all") {
		if (pinnedPlugins.length === 0) return {};
		return { plugins: unique([...(pinned?.enabledPlugins ?? []), ...pinnedPlugins]) };
	}
	return {
		skills: [...abilities.skills],
		mcpServers: [...abilities.mcpServers],
		plugins: unique([...abilities.plugins, ...pinnedPlugins]),
	};
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}
