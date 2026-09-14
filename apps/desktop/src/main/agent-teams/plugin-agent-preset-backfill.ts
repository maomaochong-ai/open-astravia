import { createHash } from "node:crypto";
import type { AgentProfile, AgentTeamDocument, TeamDefinition, TeamMember } from "@vetta/agent-team";
import { normalizeMentionHandle } from "@vetta/agent-team";
import type { PluginAgentPreset, PluginTeamPreset } from "./plugin-agent-presets.js";

export interface PluginPresetBackfillInput {
	readonly document: AgentTeamDocument;
	readonly agents: readonly PluginAgentPreset[];
	readonly teams: readonly PluginTeamPreset[];
	readonly now?: () => number;
}

export interface PluginPresetBackfillResult {
	readonly document: AgentTeamDocument;
	readonly installedAgentIds: readonly string[];
	readonly installedTeamIds: readonly string[];
}

/**
 * 把扩展贡献的智能体与团队铺进用户的 Agent 配置，并保证它们始终在位。
 *
 * 判定依据是「文档里现在有没有」，不是「历史上铺过没有」：这些资源由提供方维护、用户删不掉，
 * 缺失只可能来自旧版本的数据或一次异常，补回来才是正确状态。
 *
 * 认领优先于新建：档案的 blueprintId 命中预设声明的历史 id 时就地升级那一份，而不是再铺一份
 * 同角色的新档案——人设换了提供方，用户的 @handle、能力勾选与团队绑定都不该跟着重置。
 *
 * 返回 undefined 表示没有任何改动，调用方就不必写盘。
 */
export function backfillPluginAgentPresets(input: PluginPresetBackfillInput): PluginPresetBackfillResult | undefined {
	const now = input.now?.() ?? Date.now();
	const agents = [...input.document.agents];
	const teams = [...input.document.teams];
	const handles = new Set(
		agents
			.filter((agent) => agent.scope.kind === "library")
			.map((agent) => normalizeMentionHandle(agent.mentionHandle)),
	);
	const installedAgentIds: string[] = [];
	const installedTeamIds: string[] = [];
	let changed = false;

	for (const preset of input.agents) {
		const index = findClaimableAgent(agents, preset);
		if (index >= 0) {
			const claimed = claimAgent(agents[index]!, preset, now);
			if (claimed !== agents[index]) {
				agents[index] = claimed;
				changed = true;
			}
			continue;
		}
		const id = pluginAgentProfileId(preset.pluginId, preset.agentId);
		agents.push({
			id,
			revision: 1,
			name: preset.profileName,
			description: preset.profileDescription,
			mentionHandle: allocateHandle(preset.mentionHandle, handles),
			blueprintId: preset.blueprint.id,
			// 不落 systemPrompt：留空才能让提供方升级人设时，没手改过的用户自动跟上。
			abilities: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] },
			scope: { kind: "library" },
			source: { kind: "plugin", pluginId: preset.pluginId },
			createdAt: now,
			updatedAt: now,
		});
		changed = true;
		installedAgentIds.push(id);
	}

	for (const preset of input.teams) {
		const index = findClaimableTeam(teams, preset);
		if (index >= 0) {
			const claimed = claimTeam(teams[index]!, preset, agents, now);
			if (claimed !== teams[index]) {
				teams[index] = claimed;
				changed = true;
			}
			continue;
		}
		const members = resolveTeamMembers(preset, agents);
		if (!members) {
			// 引用不到的成员会让整份配置在 assertTeamInvariants 处读废，宁可这次不发这支团队。
			continue;
		}
		const id = pluginTeamId(preset.pluginId, preset.teamId);
		teams.push({
			id,
			revision: 1,
			name: preset.name,
			description: preset.description,
			leaderMemberId: members[0]!.id,
			members,
			orchestrationPolicyId: "leader-delegates-v1",
			contextPolicyId: "public-results-v1",
			source: { kind: "plugin", pluginId: preset.pluginId },
			createdAt: now,
			updatedAt: now,
		});
		changed = true;
		installedTeamIds.push(id);
	}

	if (!changed) return undefined;
	return {
		document: { ...input.document, revision: input.document.revision + 1, agents, teams },
		installedAgentIds,
		installedTeamIds,
	};
}

/** 已经是这份预设的档案，或写着它历史 id 的老档案。 */
function findClaimableAgent(agents: readonly AgentProfile[], preset: PluginAgentPreset): number {
	const claimable = new Set<string>([preset.blueprint.id, ...preset.legacyBlueprintIds]);
	return agents.findIndex((agent) => agent.scope.kind === "library" && claimable.has(agent.blueprintId));
}

/**
 * 认领一份已有档案：只补提供方与 blueprintId，用户改过的名字、说明、能力一概不动。
 *
 * revision 刻意不加：这是同一份档案换了人设来源，不是用户的一次编辑，不该让正打开的编辑器
 * 以为自己拿着过期数据。
 */
function claimAgent(agent: AgentProfile, preset: PluginAgentPreset, now: number): AgentProfile {
	const claimed = agent.source?.kind === "plugin" && agent.source.pluginId === preset.pluginId;
	if (claimed && agent.blueprintId === preset.blueprint.id) return agent;
	return {
		...agent,
		blueprintId: preset.blueprint.id,
		source: { kind: "plugin", pluginId: preset.pluginId },
		updatedAt: now,
	};
}

function findClaimableTeam(teams: readonly TeamDefinition[], preset: PluginTeamPreset): number {
	const claimable = new Set<string>([pluginTeamId(preset.pluginId, preset.teamId), ...preset.legacyTeamIds]);
	return teams.findIndex((team) => claimable.has(team.id));
}

/**
 * 团队的阵容与任务书都可能被用户改过，认领时只补提供方——外加一档「补员」。
 *
 * 补员是跨插件引用逼出来的：X 的团队里那个 developer 槽，可能在铺这支团队时提供方还没装。
 * 提供方后来到位了，槽位得能自己长出来，否则用户只能删掉团队重装 X。
 */
function claimTeam(
	team: TeamDefinition,
	preset: PluginTeamPreset,
	agents: readonly AgentProfile[],
	now: number,
): TeamDefinition {
	const claimed = team.source?.kind === "plugin" && team.source.pluginId === preset.pluginId;
	const grown = growTeamRoster(team, preset, agents);
	if (claimed && !grown) return team;
	return {
		...team,
		...(grown ? { members: grown } : {}),
		source: { kind: "plugin", pluginId: preset.pluginId },
		updatedAt: now,
	};
}

/**
 * 把提供方后来才解析得到的成员补进这支团队；没有可补的返回 undefined。
 *
 * **只在阵容还是提供方铺的那一份时动手**：成员 id 全都能由本预设推导出来才算。用户自己加过
 * 人就整支不动——宁可少补一个，也不该往用户编辑过的阵容里插队。
 *
 * 反过来，用户删掉的预设成员会被补回来。这与档案的语义一致：提供方维护的资源，缺失只可能
 * 来自旧数据或一次异常。
 */
function growTeamRoster(
	team: TeamDefinition,
	preset: PluginTeamPreset,
	agents: readonly AgentProfile[],
): TeamMember[] | undefined {
	const derivable = new Set<string>(
		preset.members.flatMap((member, index) => [
			pluginTeamMemberId(preset.pluginId, preset.teamId, member.slotKey),
			// 成员 id 曾经按下标推导。存量团队认这一档，否则它们永远长不出新成员。
			legacyPluginTeamMemberId(preset.pluginId, preset.teamId, index),
		]),
	);
	if (!team.members.every((member) => derivable.has(member.id))) return undefined;

	const bound = new Set(team.members.map((member) => member.binding.agentProfileId));
	const handles = new Set(team.members.map((member) => normalizeMentionHandle(member.handle)));
	const members = [...team.members];
	let changed = false;

	for (const member of preset.members) {
		const profile = findLibraryProfile(agents, member.blueprintId);
		// 按绑定的档案判重，不按 id：存量团队里那名成员带的还是下标推导出来的老 id。
		if (!profile || bound.has(profile.id)) continue;
		members.push({
			id: pluginTeamMemberId(preset.pluginId, preset.teamId, member.slotKey),
			handle: allocateHandle(profile.mentionHandle, handles),
			binding: { kind: "reference", agentProfileId: profile.id },
			assignment: { responsibility: member.responsibility },
		});
		bound.add(profile.id);
		changed = true;
	}

	return changed ? members : undefined;
}

function findLibraryProfile(agents: readonly AgentProfile[], blueprintId: string): AgentProfile | undefined {
	return agents.find((agent) => agent.scope.kind === "library" && agent.blueprintId === blueprintId);
}

function resolveTeamMembers(preset: PluginTeamPreset, agents: readonly AgentProfile[]): TeamMember[] | undefined {
	const members: TeamMember[] = [];
	const handles = new Set<string>();
	for (const [index, member] of preset.members.entries()) {
		const profile = findLibraryProfile(agents, member.blueprintId);
		if (!profile) return undefined;
		members.push({
			id: pluginTeamMemberId(preset.pluginId, preset.teamId, member.slotKey),
			handle: allocateHandle(profile.mentionHandle, handles),
			binding: { kind: "reference", agentProfileId: profile.id },
			assignment: {
				responsibility: member.responsibility,
				// 队长带这支团队的流水线任务书，其余成员只有职责说明。
				...(index === 0 && preset.workflow ? { instructions: preset.workflow } : {}),
			},
		});
	}
	return members.length > 0 ? members : undefined;
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
 * 漂——它们身上挂着用户的 handle 和运行时状态。
 */
function pluginTeamMemberId(pluginId: string, teamId: string, slotKey: string): string {
	return deterministicId("team-member", `${pluginId}:${teamId}:${slotKey}`);
}

/**
 * 槽位 id 之前的算法：按成员下标。
 *
 * 存量文档里的成员带的就是这种 id，认领与补员都要认它。**不做迁移**：成员 id 只要在一份文档
 * 内稳定就够用，重写它反而要同步动运行时状态里的引用。
 */
function legacyPluginTeamMemberId(pluginId: string, teamId: string, index: number): string {
	return deterministicId("team-member", `${pluginId}:${teamId}:${index}`);
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
