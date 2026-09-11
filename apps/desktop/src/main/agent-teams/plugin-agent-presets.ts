import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { AgentBlueprint } from "@vetta/agent-team";
import { EMPTY_AGENT_ABILITIES, pluginBlueprintId } from "@vetta/agent-team";
import type { InstalledPlugin } from "../../preload/api-types/plugins.js";

/**
 * 解析 manifest 里的 `%key%` 占位，语义对齐 SDK 的 resolvePluginText。
 *
 * 刻意不 import SDK 的实现：那个 barrel 会把 React 一起拽进主进程包。规则只有「整串
 * 恰好是 %key% 才查表，否则原样返回」这一条，抄十行比拖一个 UI 依赖划算。
 */
function resolvePluginText(raw: string, locales: Record<string, Record<string, string>>, locale: string): string {
	const match = /^%([^%]+)%$/.exec(raw);
	if (!match) return raw;
	const key = match[1]!;
	return locales[locale]?.[key] ?? key;
}

const AVATAR_MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
	".webp": "image/webp",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
});

/** 单张头像的上限。Blueprint 会整体过一次 IPC，插件塞张壁纸进来不该拖垮列表。 */
const MAX_AVATAR_BYTES = 512 * 1024;

export interface PluginTeamPresetMember {
	/** 本插件智能体的全局 blueprint id。 */
	readonly blueprintId: string;
	readonly responsibility: string;
}

export interface PluginTeamPreset {
	readonly pluginId: string;
	/** 插件内的团队 id，用于推导稳定的全局 id。 */
	readonly teamId: string;
	readonly name: string;
	readonly description: string;
	readonly members: readonly PluginTeamPresetMember[];
	/** 队长的团队任务书。 */
	readonly workflow: string;
	/** 本团队接管的历史团队 id，用于认领用户已有的同一支团队。 */
	readonly legacyTeamIds: readonly string[];
}

export interface PluginAgentPreset {
	readonly pluginId: string;
	/** 插件内的智能体 id，用于推导稳定的全局 id。 */
	readonly agentId: string;
	readonly blueprint: AgentBlueprint;
	/** 铺档案时用的字面名称（已按插件默认语言解析）。 */
	readonly profileName: string;
	readonly profileDescription: string;
	readonly mentionHandle: string;
	/** 本智能体接管的历史 blueprint id，用于折算老档案与认领同角色档案。 */
	readonly legacyBlueprintIds: readonly string[];
}

export interface PluginAgentPresetBundle {
	readonly agents: readonly PluginAgentPreset[];
	readonly teams: readonly PluginTeamPreset[];
}

export interface PluginAgentPresetLogger {
	warn(message: string, meta?: Record<string, unknown>): void;
}

export interface BuildPluginAgentPresetsInput {
	readonly plugins: readonly InstalledPlugin[];
	readonly logger: PluginAgentPresetLogger;
	/** 覆盖磁盘读取，仅测试用。 */
	readonly readResource?: (plugin: InstalledPlugin, relativePath: string) => string | undefined;
	readonly readBinaryResource?: (plugin: InstalledPlugin, relativePath: string) => Buffer | undefined;
}

/**
 * 从已启用插件的 manifest 里抽出它们贡献的智能体与团队。
 *
 * 只认已启用的插件：禁用即等同于 blueprint 消失，引用它的用户档案会降级展示。这正是
 * 我们要的语义——用户重新启用插件，一切原样回来，中间不动它的档案。
 */
export function buildPluginAgentPresets(input: BuildPluginAgentPresetsInput): PluginAgentPresetBundle {
	const agents: PluginAgentPreset[] = [];
	const teams: PluginTeamPreset[] = [];

	for (const plugin of input.plugins) {
		if (!plugin.enabled) continue;
		const declaredAgents = plugin.agent?.agents ?? [];
		const declaredTeams = plugin.agent?.teams ?? [];
		if (declaredAgents.length === 0 && declaredTeams.length === 0) continue;

		const ownAgentIds = new Set<string>();
		for (const declared of declaredAgents) {
			try {
				agents.push(buildAgentPreset(plugin, declared, input));
				ownAgentIds.add(declared.id);
			} catch (error) {
				input.logger.warn("skipping a plugin agent contribution", {
					pluginId: plugin.id,
					agentId: declared.id,
					error: errorMessage(error),
				});
			}
		}

		for (const declared of declaredTeams) {
			try {
				teams.push(buildTeamPreset(plugin, declared, ownAgentIds, input));
			} catch (error) {
				input.logger.warn("skipping a plugin team contribution", {
					pluginId: plugin.id,
					teamId: declared.id,
					error: errorMessage(error),
				});
			}
		}
	}

	return { agents, teams };
}

function buildAgentPreset(
	plugin: InstalledPlugin,
	declared: NonNullable<NonNullable<InstalledPlugin["agent"]>["agents"]>[number],
	input: BuildPluginAgentPresetsInput,
): PluginAgentPreset {
	const systemPrompt = declared.systemPromptPath
		? readTextResource(plugin, declared.systemPromptPath, input)
		: declared.systemPrompt;
	if (!systemPrompt || systemPrompt.trim().length === 0) {
		throw new Error("agent declares neither systemPrompt nor a readable systemPromptPath");
	}

	const defaultLocale = plugin.defaultLocale ?? "zh";
	const rawName = declared.name;
	const rawDescription = declared.description ?? "";
	const avatarUrl = declared.avatar ? readAvatarDataUrl(plugin, declared.avatar, input) : undefined;

	const blueprint: AgentBlueprint = {
		id: pluginBlueprintId(plugin.id, declared.id),
		// 插件 blueprint 走字面量，这两个 key 用不到；留空串比留假 key 诚实。
		nameKey: "",
		descriptionKey: "",
		// 原样保留 `%key%`：渲染进程拿插件 locales 现场解析，切语言才能立刻跟上。
		name: rawName,
		description: rawDescription,
		systemPrompt: systemPrompt.trimEnd(),
		defaultAbilities:
			declared.abilities === "own"
				? { ...EMPTY_AGENT_ABILITIES, selectionMode: "custom", plugins: [plugin.id] }
				: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] },
		source: { kind: "plugin", pluginId: plugin.id },
		...(avatarUrl ? { avatarUrl } : {}),
		// 这个智能体存在的意义就是操作它自己的插件，能力面板关不掉它。
		pinnedPlugins: [plugin.id],
	};

	return {
		pluginId: plugin.id,
		agentId: declared.id,
		blueprint,
		profileName: resolvePluginText(rawName, plugin.locales ?? {}, defaultLocale),
		profileDescription: rawDescription ? resolvePluginText(rawDescription, plugin.locales ?? {}, defaultLocale) : "",
		mentionHandle: declared.mentionHandle ?? declared.id,
		legacyBlueprintIds: declared.legacyIds ?? [],
	};
}

function buildTeamPreset(
	plugin: InstalledPlugin,
	declared: NonNullable<NonNullable<InstalledPlugin["agent"]>["teams"]>[number],
	ownAgentIds: ReadonlySet<string>,
	input: BuildPluginAgentPresetsInput,
): PluginTeamPreset {
	const workflow = declared.workflowPath ? readTextResource(plugin, declared.workflowPath, input) : declared.workflow;
	const defaultLocale = plugin.defaultLocale ?? "zh";
	const members = declared.members.map((member: { agent: string; responsibility: string }): PluginTeamPresetMember => {
		if (!ownAgentIds.has(member.agent)) {
			// 刻意不支持跨插件引用：那会让一个插件能否用取决于另一个插件装没装。
			throw new Error(`team member is not one of this plugin's agents: ${member.agent}`);
		}
		return { blueprintId: pluginBlueprintId(plugin.id, member.agent), responsibility: member.responsibility };
	});

	return {
		pluginId: plugin.id,
		teamId: declared.id,
		name: resolvePluginText(declared.name, plugin.locales ?? {}, defaultLocale),
		description: declared.description
			? resolvePluginText(declared.description, plugin.locales ?? {}, defaultLocale)
			: "",
		members,
		workflow: workflow?.trimEnd() ?? "",
		legacyTeamIds: declared.legacyIds ?? [],
	};
}

function readTextResource(
	plugin: InstalledPlugin,
	relativePath: string,
	input: BuildPluginAgentPresetsInput,
): string | undefined {
	if (input.readResource) return input.readResource(plugin, relativePath);
	const target = safeResolve(plugin, relativePath);
	if (!target || !existsSync(target)) return undefined;
	return readFileSync(target, "utf-8");
}

function readAvatarDataUrl(
	plugin: InstalledPlugin,
	relativePath: string,
	input: BuildPluginAgentPresetsInput,
): string | undefined {
	const mediaType = AVATAR_MEDIA_TYPES[extname(relativePath).toLowerCase()];
	if (!mediaType) throw new Error(`unsupported avatar format: ${relativePath}`);
	const content = input.readBinaryResource
		? input.readBinaryResource(plugin, relativePath)
		: readBinaryResource(plugin, relativePath);
	if (!content) throw new Error(`avatar is missing: ${relativePath}`);
	if (content.byteLength > MAX_AVATAR_BYTES) throw new Error(`avatar exceeds ${MAX_AVATAR_BYTES} bytes`);
	// 内联成 data URL 而不是 vetta-plugin:// 地址：系统插件、dev 链接、已安装包各有一套
	// URL 规则，头像只有几十 KB，内联能一次绕开三条分支和版本号/reload token 的时序。
	return `data:${mediaType};base64,${content.toString("base64")}`;
}

function readBinaryResource(plugin: InstalledPlugin, relativePath: string): Buffer | undefined {
	const target = safeResolve(plugin, relativePath);
	if (!target || !existsSync(target)) return undefined;
	return readFileSync(target);
}

/** 越界检查：manifest 里的相对路径不许跳出插件目录。 */
function safeResolve(plugin: InstalledPlugin, relativePath: string): string | undefined {
	const root = plugin.rootPath;
	if (!root) return undefined;
	const target = resolve(root, relativePath);
	if (target !== root && !target.startsWith(`${root}/`) && !target.startsWith(`${root}\\`)) return undefined;
	return target;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
