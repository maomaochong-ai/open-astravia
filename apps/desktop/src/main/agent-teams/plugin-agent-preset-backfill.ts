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
			const claimed = claimTeam(teams[index]!, preset, now);
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

/** 团队的阵容与任务书都可能被用户改过，认领时只补提供方。 */
function claimTeam(team: TeamDefinition, preset: PluginTeamPreset, now: number): TeamDefinition {
	if (team.source?.kind === "plugin" && team.source.pluginId === preset.pluginId) return team;
	return { ...team, source: { kind: "plugin", pluginId: preset.pluginId }, updatedAt: now };
}

function resolveTeamMembers(preset: PluginTeamPreset, agents: readonly AgentProfile[]): TeamMember[] | undefined {
	const members: TeamMember[] = [];
	const handles = new Set<string>();
	for (const [index, member] of preset.members.entries()) {
		const profile = agents.find(
			(agent) => agent.scope.kind === "library" && agent.blueprintId === member.blueprintId,
		);
		if (!profile) return undefined;
		members.push({
			id: pluginTeamMemberId(preset.pluginId, preset.teamId, index),
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

function pluginTeamMemberId(pluginId: string, teamId: string, index: number): string {
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
