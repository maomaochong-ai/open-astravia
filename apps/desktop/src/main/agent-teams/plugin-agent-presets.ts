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
	const key = pluginTextKey(raw);
	if (key === undefined) return raw;
	return locales[locale]?.[key] ?? key;
}

/** 整串恰好是 `%key%` 时取出 key；字面量返回 undefined。 */
function pluginTextKey(raw: string | undefined): string | undefined {
	return raw ? /^%([^%]+)%$/.exec(raw)?.[1] : undefined;
}

/**
 * 名称与描述的语言包 key，随档案落盘。
 *
 * 档案里的字面量只能是一种语言，界面拿这两个 key 按当前语言现场解析；字面量写法的插件没有
 * key，也就没什么可切的。
 */
export interface PluginPresetTextKeys {
	readonly nameKey?: string;
	readonly descriptionKey?: string;
}

function presetTextKeys(name: string, description: string | undefined): PluginPresetTextKeys {
	const nameKey = pluginTextKey(name);
	const descriptionKey = pluginTextKey(description);
	return { ...(nameKey ? { nameKey } : {}), ...(descriptionKey ? { descriptionKey } : {}) };
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
	/**
	 * 槽位 key：成员 id 由它推导。
	 *
	 * 角色槽位取角色名，实体引用取引用串。**刻意不取解析结果**——槽位是稳定的，占槽的人是
	 * 可替换的，developer 从一个插件换到另一个插件时用户的绑定不该跟着重置。
	 */
	readonly slotKey: string;
	/** 解析到的智能体的全局 blueprint id。 */
	readonly blueprintId: string;
	/** 供货的插件。跨插件引用时与团队所属插件不同。 */
	readonly providerPluginId: string;
	/** 经角色槽位解析到的话，这里是角色 slug。 */
	readonly role?: string;
	readonly responsibility: string;
	/**
	 * 这名成员在本团队里的任务书。
	 *
	 * 挂在团队上，不碰对方的人设——跨插件拉来的成员因此可以被交待本团队的做事方式，而它在
	 * 别处照旧。队长的任务书走团队级的 {@link PluginTeamPreset.workflow}。
	 */
	readonly instructions?: string;
}

export interface PluginTeamPreset {
	readonly pluginId: string;
	/** 插件内的团队 id，用于推导稳定的全局 id。 */
	readonly teamId: string;
	readonly name: string;
	readonly description: string;
	readonly textKeys: PluginPresetTextKeys;
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
	/** 铺档案时用的字面名称（已按插件默认语言解析）；界面另按 {@link profileTextKeys} 跟随语言。 */
	readonly profileName: string;
	readonly profileDescription: string;
	readonly profileTextKeys: PluginPresetTextKeys;
	readonly mentionHandle: string;
	/** 本智能体接管的历史 blueprint id，用于折算老档案与认领同角色档案。 */
	readonly legacyBlueprintIds: readonly string[];
	/** 本智能体对外供货的角色 slug；别的插件按它引用到这里。 */
	readonly roles: readonly string[];
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

/** 已解析的智能体索引，供团队装配阶段查引用。 */
interface AgentPresetIndex {
	/** `${pluginId}/${agentId}` → 智能体。实体引用走这张表。 */
	readonly byKey: ReadonlyMap<string, PluginAgentPreset>;
	/** 角色 slug → 候选智能体，已按 pluginId 字典序排好。 */
	readonly byRole: ReadonlyMap<string, readonly PluginAgentPreset[]>;
}

/**
 * 从已启用插件的 manifest 里抽出它们贡献的智能体与团队。
 *
 * 只认已启用的插件：禁用即等同于 blueprint 消失，引用它的用户档案会降级展示。这正是
 * 我们要的语义——用户重新启用插件，一切原样回来，中间不动它的档案。
 *
 * 分两趟：先把所有插件的智能体收齐，再装配团队。团队成员可以引用别的插件的智能体，单趟
 * 循环时后面的插件还没解析出来，引用就会随插件顺序时灵时不灵。
 */
export function buildPluginAgentPresets(input: BuildPluginAgentPresetsInput): PluginAgentPresetBundle {
	const agents: PluginAgentPreset[] = [];
	const enabled = input.plugins.filter((plugin) => plugin.enabled);

	for (const plugin of enabled) {
		for (const declared of plugin.agent?.agents ?? []) {
			try {
				agents.push(buildAgentPreset(plugin, declared, input));
			} catch (error) {
				input.logger.warn("skipping a plugin agent contribution", {
					pluginId: plugin.id,
					agentId: declared.id,
					error: errorMessage(error),
				});
			}
		}
	}

	const index = buildAgentPresetIndex(agents);
	const teams: PluginTeamPreset[] = [];

	for (const plugin of enabled) {
		for (const declared of plugin.agent?.teams ?? []) {
			try {
				teams.push(buildTeamPreset(plugin, declared, index, input));
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

function buildAgentPresetIndex(agents: readonly PluginAgentPreset[]): AgentPresetIndex {
	const byKey = new Map<string, PluginAgentPreset>();
	const byRole = new Map<string, PluginAgentPreset[]>();
	for (const preset of agents) {
		byKey.set(agentRefKey(preset.pluginId, preset.agentId), preset);
		for (const role of preset.roles) {
			const bucket = byRole.get(role);
			if (bucket) bucket.push(preset);
			else byRole.set(role, [preset]);
		}
	}
	// 候选排序只能看 pluginId，绝不能看数组顺序：那是插件目录的枚举顺序，同一份配置在两台
	// 机器上会铺出不同的团队。
	for (const bucket of byRole.values()) {
		bucket.sort((left, right) => (left.pluginId < right.pluginId ? -1 : left.pluginId > right.pluginId ? 1 : 0));
	}
	return { byKey, byRole };
}

function agentRefKey(pluginId: string, agentId: string): string {
	return `${pluginId}/${agentId}`;
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
		profileTextKeys: presetTextKeys(rawName, rawDescription),
		mentionHandle: declared.mentionHandle ?? declared.id,
		legacyBlueprintIds: declared.legacyIds ?? [],
		roles: declared.roles ?? [],
	};
}

interface DeclaredTeamMember {
	readonly agent?: string;
	readonly role?: string;
	readonly responsibility: string;
	readonly optional?: boolean;
	readonly instructions?: string;
	readonly instructionsPath?: string;
}

/**
 * 解析一名声明的成员。解析不到返回 undefined —— 是否致命由 {@link isMemberRequired} 决定。
 */
function resolveTeamMember(
	consumerPluginId: string,
	member: DeclaredTeamMember,
	index: AgentPresetIndex,
): PluginAgentPreset | undefined {
	if (member.agent) {
		const slash = member.agent.indexOf("/");
		const key =
			slash < 0
				? agentRefKey(consumerPluginId, member.agent)
				: agentRefKey(member.agent.slice(0, slash), member.agent.slice(slash + 1));
		return index.byKey.get(key);
	}
	const candidates = index.byRole.get(member.role ?? "") ?? [];
	// 本插件的人优先顶自己的槽；否则取字典序第一个候选。
	return candidates.find((candidate) => candidate.pluginId === consumerPluginId) ?? candidates[0];
}

/**
 * 解析不到时该不该让整支团队作废。
 *
 * 本插件的实体引用缺了就是配置错误，作废才能让作者立刻发现；跨插件引用与角色槽位缺了只是
 * 提供方不在场，少一名队员即可——这正是「引用别人不该拖垮自己」的那条线。
 */
function isMemberRequired(member: DeclaredTeamMember): boolean {
	if (member.optional !== undefined) return !member.optional;
	return member.agent !== undefined && !member.agent.includes("/");
}

function teamMemberSlotKey(member: DeclaredTeamMember): string {
	return member.role ?? member.agent ?? "";
}

function buildTeamPreset(
	plugin: InstalledPlugin,
	declared: NonNullable<NonNullable<InstalledPlugin["agent"]>["teams"]>[number],
	index: AgentPresetIndex,
	input: BuildPluginAgentPresetsInput,
): PluginTeamPreset {
	const workflow = declared.workflowPath ? readTextResource(plugin, declared.workflowPath, input) : declared.workflow;
	const defaultLocale = plugin.defaultLocale ?? "zh";
	const members: PluginTeamPresetMember[] = [];
	const slotKeys = new Set<string>();

	for (const [position, member] of (declared.members as readonly DeclaredTeamMember[]).entries()) {
		const slotKey = teamMemberSlotKey(member);
		if (slotKeys.has(slotKey)) throw new Error(`duplicate team member slot: ${slotKey}`);
		slotKeys.add(slotKey);

		const resolved = resolveTeamMember(plugin.id, member, index);
		if (position === 0 && resolved?.pluginId !== plugin.id) {
			// 队长解析不到就没有对话入口了，这支团队会变成打不开的壳。清单校验已经拦过一道，
			// 这里再兜一次：manifest 可能来自旧版本的包。
			throw new Error("the team leader must resolve to one of this plugin's own agents");
		}
		if (!resolved) {
			if (isMemberRequired(member)) throw new Error(`team member cannot be resolved: ${slotKey}`);
			continue;
		}
		// 任务书从消费方的包里读：写它的人是声明这支团队的插件，不是被引用的那一方。
		const instructions = member.instructionsPath
			? readTextResource(plugin, member.instructionsPath, input)
			: member.instructions;
		if (member.instructionsPath && !instructions) {
			throw new Error(`team member brief is missing: ${member.instructionsPath}`);
		}
		members.push({
			slotKey,
			blueprintId: pluginBlueprintId(resolved.pluginId, resolved.agentId),
			providerPluginId: resolved.pluginId,
			...(member.role ? { role: member.role } : {}),
			responsibility: member.responsibility,
			...(instructions?.trim() ? { instructions: instructions.trimEnd() } : {}),
		});
	}

	return {
		pluginId: plugin.id,
		teamId: declared.id,
		name: resolvePluginText(declared.name, plugin.locales ?? {}, defaultLocale),
		description: declared.description
			? resolvePluginText(declared.description, plugin.locales ?? {}, defaultLocale)
			: "",
		textKeys: presetTextKeys(declared.name, declared.description),
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
