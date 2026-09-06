import type { InstalledPlugin, InstalledSkill, McpConfigData, SkillInfo } from "@preload/api";
import { builtinSkillIconUrl } from "@shared/lib/builtin-skill-icons";
import { resolvePluginText } from "@vetta-org/plugin-sdk";
import { resolveMcpIcon } from "../../settings/mcp/builtin-mcp-presets";

export type AgentCapabilityKind = "skill" | "scene" | "mcp" | "plugin";

export interface AgentCapabilityOption {
	readonly id: string;
	readonly kind: AgentCapabilityKind;
	readonly title: string;
	readonly description: string;
	readonly icon?: string;
	readonly enabledGlobally: boolean;
	/** 插件贡献 skill 的来源插件 ID；用于来源展示及插件能力联动。 */
	readonly sourcePluginId?: string;
	readonly sourceName?: string;
	readonly source?: string;
}

export function buildAgentCapabilityOptions(input: {
	readonly skills: readonly SkillInfo[];
	readonly skillManifest: Readonly<Record<string, InstalledSkill>>;
	readonly mcpConfig: McpConfigData;
	readonly plugins: readonly InstalledPlugin[];
	/** 当前宿主 locale，用于解析插件 manifest 的 `%key%` 文案。 */
	readonly locale?: string;
}): readonly AgentCapabilityOption[] {
	const options: AgentCapabilityOption[] = [];

	for (const skill of input.skills) {
		const manifest = input.skillManifest[skill.name];
		const sourcePlugin = skill.sourcePluginId
			? input.plugins.find((plugin) => plugin.id === skill.sourcePluginId)
			: undefined;
		options.push({
			id: skill.name,
			kind: skill.type,
			title: skill.alias || skill.name,
			description: skill.description,
			icon: skill.icon ?? (skill.source === "builtin" ? builtinSkillIconUrl(skill.name) : undefined),
			enabledGlobally: skill.sourcePluginId ? (sourcePlugin?.enabled ?? false) : (manifest?.enabled ?? true),
			source: skill.source,
			...(skill.sourcePluginId ? { sourcePluginId: skill.sourcePluginId } : {}),
			...(sourcePlugin
				? {
						sourceName: resolvePluginName(sourcePlugin, input.locale),
					}
				: {}),
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
			source: "mcp",
		});
	}

	for (const plugin of input.plugins) {
		options.push({
			id: plugin.id,
			kind: "plugin",
			title: resolvePluginName(plugin, input.locale),
			description: plugin.description
				? (resolvePluginManifestText(plugin.description, plugin, input.locale) ?? "")
				: "",
			icon: plugin.iconUrl,
			enabledGlobally: plugin.enabled,
			source: plugin.source,
		});
	}

	return options.sort((left, right) => left.title.localeCompare(right.title));
}

function resolvePluginName(plugin: InstalledPlugin, locale: string | undefined): string {
	return resolvePluginManifestText(plugin.name, plugin, locale) ?? plugin.id;
}

function resolvePluginManifestText(
	raw: string,
	plugin: InstalledPlugin,
	locale: string | undefined,
): string | undefined {
	const resolved = resolvePluginText(raw, plugin.locales, locale ?? plugin.defaultLocale, plugin.defaultLocale);
	const placeholder = raw.match(/^%([^%]+)%$/);
	return placeholder && resolved === placeholder[1] ? undefined : resolved;
}
