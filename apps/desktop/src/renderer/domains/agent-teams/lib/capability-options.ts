import type { InstalledPlugin, InstalledSkill, McpConfigData, SkillInfo } from "@preload/api";
import { builtinSkillIconUrl } from "@shared/lib/builtin-skill-icons";
import { resolveMcpIcon } from "../../settings/mcp/builtin-mcp-presets";

export type AgentCapabilityKind = "skill" | "scene" | "mcp" | "plugin";

export interface AgentCapabilityOption {
	readonly id: string;
	readonly kind: AgentCapabilityKind;
	readonly title: string;
	readonly description: string;
	readonly icon?: string;
	readonly enabledGlobally: boolean;
}

export function buildAgentCapabilityOptions(input: {
	readonly skills: readonly SkillInfo[];
	readonly skillManifest: Readonly<Record<string, InstalledSkill>>;
	readonly mcpConfig: McpConfigData;
	readonly plugins: readonly InstalledPlugin[];
}): readonly AgentCapabilityOption[] {
	const options: AgentCapabilityOption[] = [];

	for (const skill of input.skills) {
		const manifest = input.skillManifest[skill.name];
		options.push({
			id: skill.name,
			kind: skill.type,
			title: skill.alias || skill.name,
			description: skill.description,
			icon: skill.icon ?? (skill.source === "builtin" ? builtinSkillIconUrl(skill.name) : undefined),
			enabledGlobally: manifest?.enabled ?? true,
		});
	}

	for (const [name, server] of Object.entries(input.mcpConfig.mcpServers)) {
		options.push({
			id: name,
			kind: "mcp",
			title: server.displayName || name,
			description: server.description || "",
			icon: resolveMcpIcon(name, server) ?? undefined,
			enabledGlobally: !server.disabled,
		});
	}

	for (const plugin of input.plugins) {
		options.push({
			id: plugin.id,
			kind: "plugin",
			title: plugin.name,
			description: plugin.description || "",
			icon: plugin.iconUrl,
			enabledGlobally: plugin.enabled,
		});
	}

	return options.sort((left, right) => left.title.localeCompare(right.title));
}
