import type { AgentAbilitySelection } from "@vetta/agent-team";
import type { AgentCapabilityOption } from "./capability-options";

export type AgentAbilityKey = "skills" | "mcpServers" | "plugins";

export function abilityKeyForKind(kind: AgentCapabilityOption["kind"]): AgentAbilityKey {
	if (kind === "skill" || kind === "scene") return "skills";
	if (kind === "mcp") return "mcpServers";
	return "plugins";
}

export function isAgentAbilitySelected(abilities: AgentAbilitySelection, option: AgentCapabilityOption): boolean {
	if (abilities.selectionMode === "all") return option.enabledGlobally;
	return abilities[abilityKeyForKind(option.kind)].includes(option.id);
}

export function normalizeAgentAbilitySelection(
	abilities: AgentAbilitySelection,
	capabilities: readonly AgentCapabilityOption[],
): AgentAbilitySelection {
	if (abilities.selectionMode === "all") return abilities;
	const skills = new Set(abilities.skills);
	const plugins = new Set(abilities.plugins);
	for (const capability of capabilities) {
		if (!capability.enabledGlobally || !capability.sourcePluginId) continue;
		if (skills.has(capability.id)) plugins.add(capability.sourcePluginId);
	}
	for (const pluginId of plugins) {
		const contributedSkillIds = capabilities
			.filter((capability) => capability.enabledGlobally && capability.sourcePluginId === pluginId)
			.map((capability) => capability.id);
		// 旧配置只记录了插件 ID 时补全其 Skill；已有部分选择则保留用户的细粒度选择。
		if (!contributedSkillIds.some((id) => skills.has(id))) {
			for (const id of contributedSkillIds) skills.add(id);
		}
	}
	return {
		...abilities,
		skills: [...skills],
		plugins: [...plugins],
	};
}

export function toggleAgentAbility(
	abilities: AgentAbilitySelection,
	option: AgentCapabilityOption,
	capabilities: readonly AgentCapabilityOption[],
): AgentAbilitySelection {
	const current = abilities.selectionMode === "all" ? selectAllAgentAbilities(capabilities) : abilities;
	const key = abilityKeyForKind(option.kind);
	const selected = current[key];
	if (option.kind === "plugin") {
		const linkedSkillIds = capabilities
			.filter((candidate) => candidate.kind === "skill" || candidate.kind === "scene")
			.filter((candidate) => candidate.sourcePluginId === option.id)
			.map((candidate) => candidate.id);
		const enabling = !selected.includes(option.id);
		return {
			...current,
			selectionMode: "custom",
			plugins: enabling ? [...selected, option.id] : selected.filter((id) => id !== option.id),
			skills: enabling
				? [...new Set([...current.skills, ...linkedSkillIds])]
				: current.skills.filter((id) => !linkedSkillIds.includes(id)),
		};
	}
	if ((option.kind === "skill" || option.kind === "scene") && option.sourcePluginId) {
		const enabling = !selected.includes(option.id);
		const hasSelectedSibling = capabilities.some(
			(candidate) =>
				(candidate.kind === "skill" || candidate.kind === "scene") &&
				candidate.sourcePluginId === option.sourcePluginId &&
				candidate.id !== option.id &&
				current.skills.includes(candidate.id),
		);
		return {
			...current,
			selectionMode: "custom",
			skills: enabling ? [...selected, option.id] : selected.filter((id) => id !== option.id),
			plugins: enabling
				? [...new Set([...current.plugins, option.sourcePluginId])]
				: hasSelectedSibling
					? current.plugins
					: current.plugins.filter((id) => id !== option.sourcePluginId),
		};
	}
	return {
		...current,
		selectionMode: "custom",
		[key]: selected.includes(option.id) ? selected.filter((id) => id !== option.id) : [...selected, option.id],
	};
}

export function selectAllAgentAbilities(capabilities: readonly AgentCapabilityOption[]): AgentAbilitySelection {
	const enabled = capabilities.filter((capability) => capability.enabledGlobally);
	return {
		selectionMode: "all",
		skills: uniqueIds(enabled.filter((option) => option.kind === "skill" || option.kind === "scene")),
		mcpServers: uniqueIds(enabled.filter((option) => option.kind === "mcp")),
		plugins: uniqueIds(enabled.filter((option) => option.kind === "plugin")),
	};
}

function uniqueIds(options: readonly AgentCapabilityOption[]): string[] {
	return [...new Set(options.map((option) => option.id))];
}
