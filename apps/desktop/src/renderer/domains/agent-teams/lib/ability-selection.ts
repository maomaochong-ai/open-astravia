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

export function toggleAgentAbility(
	abilities: AgentAbilitySelection,
	option: AgentCapabilityOption,
	capabilities: readonly AgentCapabilityOption[],
): AgentAbilitySelection {
	const current = abilities.selectionMode === "all" ? selectAllAgentAbilities(capabilities) : abilities;
	const key = abilityKeyForKind(option.kind);
	const selected = current[key];
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
