import type { AgentBlueprint, AgentProfile } from "@vetta/agent-team";
import { parsePluginBlueprintId } from "@vetta/agent-team";
import { resolvePluginText } from "@vetta-org/plugin-sdk";

export interface BlueprintDisplayPlugin {
	readonly id: string;
	readonly name: string;
	readonly locales?: Record<string, Record<string, string>>;
	readonly defaultLocale?: string;
}

/**
 * 档案不可用时的原因。
 *
 * 目前只有一种：贡献它的插件被禁用或卸载了。blueprint 不可解析本身是正常状态，不是脏
 * 数据——用户重新启用插件，档案原样回来，期间我们既不隐藏也不擅自把它从团队里摘掉。
 */
export interface AgentUnavailableReason {
	readonly kind: "plugin-disabled";
	readonly pluginId: string;
	/** 插件已安装但被禁用时给出它的显示名；卸载干净了就只剩 id。 */
	readonly pluginName: string;
}

/** 解析一个档案当前为什么不可用；可用时返回 undefined。 */
export function agentUnavailableReason(
	profile: Pick<AgentProfile, "blueprintId">,
	blueprint: AgentBlueprint | undefined,
	plugins: readonly BlueprintDisplayPlugin[] = [],
): AgentUnavailableReason | undefined {
	if (blueprint) return undefined;
	const parsed = parsePluginBlueprintId(profile.blueprintId);
	if (!parsed) return undefined;
	const plugin = plugins.find((candidate) => candidate.id === parsed.pluginId);
	return {
		kind: "plugin-disabled",
		pluginId: parsed.pluginId,
		pluginName: plugin ? resolvePluginTextFor(plugin, plugin.name) : parsed.pluginId,
	};
}

/**
 * Blueprint 的角色名。内置的走宿主 i18n key，插件的带 `%key%` 字面量，按插件 locales 现场解析。
 *
 * 现场解析而不是在主进程定死：切换语言时插件智能体的角色名要跟着动。
 */
export function agentBlueprintLabel(
	blueprint: AgentBlueprint | undefined,
	translate: (key: string) => string,
	plugins: readonly BlueprintDisplayPlugin[] = [],
): string | undefined {
	if (!blueprint) return undefined;
	const source = blueprint.source;
	if (source?.kind !== "plugin") return blueprint.nameKey ? translate(blueprint.nameKey) : undefined;
	const plugin = plugins.find((candidate) => candidate.id === source.pluginId);
	const raw = blueprint.name ?? "";
	return plugin ? resolvePluginTextFor(plugin, raw) : stripPlaceholder(raw);
}

/** Blueprint 的职责说明，规则同 {@link agentBlueprintLabel}。 */
export function agentBlueprintDescription(
	blueprint: AgentBlueprint | undefined,
	translate: (key: string) => string,
	plugins: readonly BlueprintDisplayPlugin[] = [],
): string | undefined {
	if (!blueprint) return undefined;
	const source = blueprint.source;
	if (source?.kind !== "plugin") return blueprint.descriptionKey ? translate(blueprint.descriptionKey) : undefined;
	const plugin = plugins.find((candidate) => candidate.id === source.pluginId);
	const raw = blueprint.description ?? "";
	return plugin ? resolvePluginTextFor(plugin, raw) : stripPlaceholder(raw);
}

function resolvePluginTextFor(plugin: BlueprintDisplayPlugin, raw: string): string {
	if (!raw) return "";
	const locale = typeof navigator === "undefined" ? "zh" : navigator.language.split("-")[0]!;
	return resolvePluginText(raw, plugin.locales ?? {}, locale, plugin.defaultLocale ?? "zh");
}

/** 插件已经不在了，`%key%` 没处查；去掉包裹比把百分号露给用户强。 */
function stripPlaceholder(raw: string): string {
	const match = /^%([^%]+)%$/.exec(raw);
	return match ? match[1]! : raw;
}
