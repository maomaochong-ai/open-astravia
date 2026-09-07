import type { AgentAbilitySelection } from "@vetta/agent-team";

/**
 * 把 Agent Profile 的能力勾选折算成 Coding Agent 的配置覆盖。
 * `selectionMode === "all"` 返回空覆盖，表示继承全局启用的全部能力（含日后新装的），
 * 因此不能写成显式全集——那会把此后新增的能力挡在门外。
 */
export function toAgentConfigurationOverrides(abilities: AgentAbilitySelection): {
	readonly skills?: string[];
	readonly mcpServers?: string[];
	readonly plugins?: string[];
} {
	if (abilities.selectionMode === "all") return {};
	return {
		skills: [...abilities.skills],
		mcpServers: [...abilities.mcpServers],
		plugins: [...abilities.plugins],
	};
}
