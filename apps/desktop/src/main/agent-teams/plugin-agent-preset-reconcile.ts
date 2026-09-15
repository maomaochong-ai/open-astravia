import { createHash } from "node:crypto";
import type {
	AgentProfile,
	AgentTeamDocument,
	TeamDefinition,
	TeamMember,
	TeamMemberAssignment,
} from "@vetta/agent-team";
import { normalizeMentionHandle } from "@vetta/agent-team";
import type { PluginAgentPreset, PluginTeamPreset, PluginTeamPresetMember } from "./plugin-agent-presets.js";

/**
 * 已安装插件（**含禁用**）声明过的预设标识。
 *
 * 清理的判据只能是「还有没有插件声明它」，不能是「当前解析得出来吗」：插件被禁用时它的
 * 预设整体不解析，照后者会把用户只是临时关掉的插件资产一次清光。
 */
export interface PluginPresetDeclarations {
	/** 智能体的 blueprint id，含提供方声明的历史 id。 */
	readonly agentBlueprintIds: ReadonlySet<string>;
	/** 团队 id，含历史 id。 */
	readonly teamIds: ReadonlySet<string>;
}

export interface PluginPresetReconcileInput {
	readonly document: AgentTeamDocument;
	/** 当前已启用插件贡献的智能体。 */
	readonly agents: readonly PluginAgentPreset[];
	/** 当前已启用插件贡献的团队。 */
	readonly teams: readonly PluginTeamPreset[];
	/** 缺省视为「只有上面这些预设被声明过」，其余插件资产一律判为残骸。 */
	readonly declarations?: PluginPresetDeclarations;
	readonly now?: () => number;
}

export interface PluginPresetReconcileResult {
	readonly document: AgentTeamDocument;
	readonly installedAgentIds: readonly string[];
	readonly installedTeamIds: readonly string[];
	readonly removedAgentIds: readonly string[];
	readonly removedTeamIds: readonly string[];
}

/**
 * 把用户配置里属于插件的那一部分，对齐成插件清单此刻的样子。
 *
 * 插件贡献的智能体与团队由提供方 1:1 维护：用户改不动、删不掉，插件升级就用新的整体覆盖旧的
 * ——名字、说明、阵容、任务书全部以清单为准。这是**声明式**的：清单里没有的插件资产会被清掉，
 * 否则「上一版铺下的团队」会永远活在用户机器上，作者再也收不回。
 *
 * 只有 {@link PluginPresetDeclarations} 里再没人声明的才算残骸。插件只是被禁用时，它的资产
 * 原样留在列表里降级展示——用户重新启用，一切照旧，中间不动它们。
 *
 * 返回 undefined 表示配置已经与清单一致，调用方不必写盘。
 */
export function reconcilePluginAgentPresets(
	input: PluginPresetReconcileInput,
): PluginPresetReconcileResult | undefined {
	const now = input.now?.() ?? Date.now();
	const declarations = input.declarations ?? declarationsOf(input.agents, input.teams);
	const dropped = dropUndeclaredPluginResources(input.document, declarations);
	const applied = applyPluginPresets(dropped.document, input.agents, input.teams, now);

	if (!applied && dropped.removedAgentIds.length === 0 && dropped.removedTeamIds.length === 0) return undefined;
	const document = applied?.document ?? dropped.document;
	return {
		document: { ...document, revision: input.document.revision + 1 },
		installedAgentIds: applied?.installedAgentIds ?? [],
		installedTeamIds: applied?.installedTeamIds ?? [],
		removedAgentIds: dropped.removedAgentIds,
		removedTeamIds: dropped.removedTeamIds,
	};
}

/** 没有单独给出声明集合时，按「当前这批预设就是全部声明」推导。 */
function declarationsOf(
	agents: readonly PluginAgentPreset[],
	teams: readonly PluginTeamPreset[],
): PluginPresetDeclarations {
	return {
		agentBlueprintIds: new Set(agents.flatMap((preset) => [preset.blueprint.id, ...preset.legacyBlueprintIds])),
		teamIds: new Set(
			teams.flatMap((preset) => [pluginTeamId(preset.pluginId, preset.teamId), ...preset.legacyTeamIds]),
		),
	};
}

interface DropResult {
	readonly document: AgentTeamDocument;
	readonly removedAgentIds: readonly string[];
	readonly removedTeamIds: readonly string[];
}

/**
 * 清掉再没有插件声明的插件资产，并把它们从用户自建的团队里摘干净。
 *
 * 只清库里的档案（`scope: library`）：团队内的副本属于那支团队，跟着它的生命周期走。引用了被
 * 清理档案的成员会被摘掉，整支队都指向它时连队一起撤——那种队本来也已经跑不起来。
 */
function dropUndeclaredPluginResources(
	document: AgentTeamDocument,
	declarations: PluginPresetDeclarations,
): DropResult {
	const removedAgentIds = new Set(
		document.agents
			.filter(
				(agent) =>
					agent.source !== undefined &&
					agent.scope.kind === "library" &&
					!declarations.agentBlueprintIds.has(agent.blueprintId),
			)
			.map((agent) => agent.id),
	);
	const removedTeamIds = new Set(
		document.teams
			.filter((team) => team.source !== undefined && !declarations.teamIds.has(team.id))
			.map((team) => team.id),
	);
	if (removedAgentIds.size === 0 && removedTeamIds.size === 0) {
		return { document, removedAgentIds: [], removedTeamIds: [] };
	}

	const teams: TeamDefinition[] = [];
	for (const team of document.teams) {
		if (removedTeamIds.has(team.id)) continue;
		const members = team.members.filter((member) => !removedAgentIds.has(member.binding.agentProfileId));
		if (members.length === team.members.length) {
			teams.push(team);
			continue;
		}
		if (members.length === 0) {
			removedTeamIds.add(team.id);
			continue;
		}
		teams.push({
			...team,
			revision: team.revision + 1,
			leaderMemberId: members.some((member) => member.id === team.leaderMemberId)
				? team.leaderMemberId
				: members[0]!.id,
			members,
		});
	}
	const agents = document.agents.filter(
		(agent) =>
			!removedAgentIds.has(agent.id) && !(agent.scope.kind === "team" && removedTeamIds.has(agent.scope.teamId)),
	);

	return {
		document: { ...document, agents, teams },
		removedAgentIds: [...removedAgentIds],
		removedTeamIds: [...removedTeamIds],
	};
}

interface ApplyResult {
	readonly document: AgentTeamDocument;
	readonly installedAgentIds: readonly string[];
	readonly installedTeamIds: readonly string[];
}

function applyPluginPresets(
	document: AgentTeamDocument,
	agentPresets: readonly PluginAgentPreset[],
	teamPresets: readonly PluginTeamPreset[],
	now: number,
): ApplyResult | undefined {
	const agents = [...document.agents];
	const installedAgentIds: string[] = [];
	const installedTeamIds: string[] = [];
	let changed = false;

	// @handle 要在整个智能体库里唯一。先占掉不由插件维护的那些，插件档案再按清单里的短名让号。
	const handles = new Set(
		agents
			.filter((agent) => agent.scope.kind === "library" && !isPresetOwned(agent, agentPresets))
			.map((agent) => normalizeMentionHandle(agent.mentionHandle)),
	);

	for (const preset of agentPresets) {
		const index = findPresetAgent(agents, preset);
		const current = index >= 0 ? agents[index]! : undefined;
		const next = presetAgentProfile(preset, current, handles, now);
		if (!current) {
			agents.push(next);
			installedAgentIds.push(next.id);
			changed = true;
			continue;
		}
		if (sameAgent(current, next)) continue;
		agents[index] = next;
		changed = true;
	}

	const teams = [...document.teams];
	for (const preset of teamPresets) {
		const index = findPresetTeam(teams, preset);
		const current = index >= 0 ? teams[index]! : undefined;
		const next = presetTeam(preset, current, agents, now);
		if (!next) {
			// 成员的档案还没到位（多半是跨插件引用的提供方没装）。这支队这一轮不发；提供方到位后
			// 的那次同步会把它补上。
			continue;
		}
		if (!current) {
			teams.push(next);
			installedTeamIds.push(next.id);
			changed = true;
			continue;
		}
		if (sameTeam(current, next)) continue;
		teams[index] = next;
		changed = true;
	}

	if (!changed) return undefined;
	return { document: { ...document, agents, teams }, installedAgentIds, installedTeamIds };
}

function isPresetOwned(agent: AgentProfile, presets: readonly PluginAgentPreset[]): boolean {
	return presets.some((preset) => matchesAgentPreset(agent, preset));
}

function matchesAgentPreset(agent: AgentProfile, preset: PluginAgentPreset): boolean {
	if (agent.scope.kind !== "library") return false;
	if (agent.id === pluginAgentProfileId(preset.pluginId, preset.agentId)) return true;
	return agent.blueprintId === preset.blueprint.id || preset.legacyBlueprintIds.includes(agent.blueprintId);
}

/**
 * 找到这份预设对应的既有档案：规范 id 优先，其次按 blueprint（含历史 id）认领。
 *
 * 认领而不是新铺一份，是为了保住档案 id：用户自建的团队、会话里的引用都挂在它上面，换 id
 * 等于把这些引用全部作废。
 */
function findPresetAgent(agents: readonly AgentProfile[], preset: PluginAgentPreset): number {
	return agents.findIndex((agent) => matchesAgentPreset(agent, preset));
}

function findPresetTeam(teams: readonly TeamDefinition[], preset: PluginTeamPreset): number {
	const claimable = new Set<string>([pluginTeamId(preset.pluginId, preset.teamId), ...preset.legacyTeamIds]);
	return teams.findIndex((team) => claimable.has(team.id));
}

/**
 * 按清单造出这份档案此刻应有的样子。
 *
 * 除 id 外一切以清单为准：名字、说明、能力都不保留用户的改动——这些档案由提供方 1:1 维护，
 * 保留一半的用户改动只会让「同一个插件在两台机器上长得不一样」。
 *
 * 两处刻意留空：`avatar` 与 `systemPrompt`。它们的真值在 blueprint 上，落进档案等于把某一版
 * 的图和提示词钉死在存量用户那里。
 */
function presetAgentProfile(
	preset: PluginAgentPreset,
	current: AgentProfile | undefined,
	handles: Set<string>,
	now: number,
): AgentProfile {
	const id = current?.id ?? pluginAgentProfileId(preset.pluginId, preset.agentId);
	return {
		id,
		revision: current ? current.revision + 1 : 1,
		name: preset.profileName,
		description: preset.profileDescription,
		mentionHandle: allocateHandle(preset.mentionHandle, handles),
		blueprintId: preset.blueprint.id,
		abilities: {
			selectionMode: preset.blueprint.defaultAbilities.selectionMode ?? "all",
			skills: [...preset.blueprint.defaultAbilities.skills],
			mcpServers: [...preset.blueprint.defaultAbilities.mcpServers],
			plugins: [...preset.blueprint.defaultAbilities.plugins],
		},
		scope: { kind: "library" },
		source: { kind: "plugin", pluginId: preset.pluginId, ...preset.profileTextKeys },
		createdAt: current?.createdAt ?? now,
		updatedAt: now,
	};
}

function presetTeam(
	preset: PluginTeamPreset,
	current: TeamDefinition | undefined,
	agents: readonly AgentProfile[],
	now: number,
): TeamDefinition | undefined {
	const members = presetTeamMembers(preset, current, agents);
	if (!members) return undefined;
	const id = current?.id ?? pluginTeamId(preset.pluginId, preset.teamId);
	return {
		id,
		revision: current ? current.revision + 1 : 1,
		name: preset.name,
		description: preset.description,
		leaderMemberId: members[0]!.id,
		members,
		orchestrationPolicyId: current?.orchestrationPolicyId ?? "leader-delegates-v1",
		contextPolicyId: current?.contextPolicyId ?? "public-results-v1",
		source: { kind: "plugin", pluginId: preset.pluginId, ...preset.textKeys },
		createdAt: current?.createdAt ?? now,
		updatedAt: now,
	};
}

/**
 * 按清单重排阵容。解析不到必选成员时返回 undefined，整支队这一轮不发。
 *
 * 成员 id 优先沿用既有那一名同岗成员的 id：运行时状态与会话记录按成员 id 索引，换 id 会让
 * 存量会话里的那名成员失联。存量团队里的成员 id 曾按下标推导，正是靠这一步继续认它。
 */
function presetTeamMembers(
	preset: PluginTeamPreset,
	current: TeamDefinition | undefined,
	agents: readonly AgentProfile[],
): TeamMember[] | undefined {
	const members: TeamMember[] = [];
	const handles = new Set<string>();
	for (const [index, member] of preset.members.entries()) {
		const profile = findLibraryProfile(agents, member.blueprintId);
		if (!profile) return undefined;
		const slotId = pluginTeamMemberId(preset.pluginId, preset.teamId, member.slotKey);
		const existing = current?.members.find(
			(candidate) => candidate.id === slotId || candidate.binding.agentProfileId === profile.id,
		);
		const assignment = memberAssignment(preset, member, index);
		members.push({
			id: existing?.id ?? slotId,
			handle: allocateHandle(profile.mentionHandle, handles),
			binding: { kind: "reference", agentProfileId: profile.id },
			...(assignment ? { assignment } : {}),
		});
	}
	return members.length > 0 ? members : undefined;
}

/**
 * 一名成员的团队内交待。
 *
 * 队长带的是团队级的流水线任务书（`workflow`），其余成员各带自己的 `instructions`——清单校验
 * 已经拦过「队长又写自己的任务书」，所以这里两者不会同时出现。
 */
function memberAssignment(
	preset: PluginTeamPreset,
	member: PluginTeamPresetMember,
	index: number,
): TeamMemberAssignment | undefined {
	const instructions = index === 0 ? preset.workflow : member.instructions;
	const responsibility = member.responsibility.trim();
	if (!responsibility && !instructions?.trim()) return undefined;
	return {
		...(responsibility ? { responsibility } : {}),
		...(instructions?.trim() ? { instructions } : {}),
	};
}

function findLibraryProfile(agents: readonly AgentProfile[], blueprintId: string): AgentProfile | undefined {
	return agents.find((agent) => agent.scope.kind === "library" && agent.blueprintId === blueprintId);
}

/** 只比内容，不比 `revision` / `updatedAt`：同步是幂等的，没改出东西就不该让版本号往前走。 */
function sameAgent(current: AgentProfile, next: AgentProfile): boolean {
	const { revision: _r, updatedAt: _u, ...left } = current;
	const { revision: _nr, updatedAt: _nu, ...right } = next;
	return stableStringify(left) === stableStringify(right);
}

function sameTeam(current: TeamDefinition, next: TeamDefinition): boolean {
	const { revision: _r, updatedAt: _u, ...left } = current;
	const { revision: _nr, updatedAt: _nu, ...right } = next;
	return stableStringify(left) === stableStringify(right);
}

/** 键序无关的序列化：两份内容相同、写入顺序不同的对象必须比成相等。 */
function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
		return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

function allocateHandle(preferred: string, taken: Set<string>): string {
	const base = normalizeMentionHandle(preferred) || "agent";
	if (!taken.has(base)) {
		taken.add(base);
		return base;
	}
	for (let suffix = 2; suffix < 100; suffix += 1) {
		const candidate = `${base}-${suffix}`;
		if (!taken.has(candidate)) {
			taken.add(candidate);
			return candidate;
		}
	}
	const fallback = `${base}-${Math.random().toString(36).slice(2, 8)}`;
	taken.add(fallback);
	return fallback;
}

export function pluginAgentProfileId(pluginId: string, agentId: string): string {
	return deterministicId("agent-profile", `${pluginId}:${agentId}`);
}

export function pluginTeamId(pluginId: string, teamId: string): string {
	return deterministicId("team", `${pluginId}:${teamId}`);
}

/**
 * 成员 id 由**槽位**推导，不由占槽的人推导。
 *
 * 槽位稳定、占槽的人可替换：角色槽位换了提供方、阵容中间插了一个人，已有成员的 id 都不该跟着
 * 漂——它们身上挂着运行时状态。
 */
function pluginTeamMemberId(pluginId: string, teamId: string, slotKey: string): string {
	return deterministicId("team-member", `${pluginId}:${teamId}:${slotKey}`);
}

/**
 * 由插件与预设 id 推导出稳定的资源 id。
 *
 * 必须是确定性的：插件卸载重装、换版本，铺出来的都得是同一份档案，否则用户会收到一堆
 * 重复的智能体。形状取 UUID 是为了和用户自建的资源长得一样——布局 v2 之后，装机资源
 * 与用户数据本就不该能一眼区分。
 */
function deterministicId(namespace: string, value: string): string {
	const digest = createHash("sha256").update(`vetta:plugin-preset:${namespace}:${value}`, "utf8").digest("hex");
	return [
		digest.slice(0, 8),
		digest.slice(8, 12),
		digest.slice(12, 16),
		digest.slice(16, 20),
		digest.slice(20, 32),
	].join("-");
}
