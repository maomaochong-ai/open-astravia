import { createHash } from "node:crypto";
import type { AgentProfile, AgentTeamDocument, TeamMember } from "@vetta/agent-team";
import { BUILTIN_AGENT_PROFILE_IDS, normalizeMentionHandle } from "@vetta/agent-team";
import type { PluginAgentPreset, PluginTeamPreset } from "./plugin-agent-presets.js";

export interface PluginPresetBackfillInput {
	readonly document: AgentTeamDocument;
	/** 已经铺过的预设 key。铺过就不再铺，用户删掉的也不会复活。 */
	readonly installedPresetIds: readonly string[];
	readonly agents: readonly PluginAgentPreset[];
	readonly teams: readonly PluginTeamPreset[];
	readonly now?: () => number;
}

export interface PluginPresetBackfillResult {
	readonly document: AgentTeamDocument;
	readonly installedPresetIds: readonly string[];
	readonly installedAgentIds: readonly string[];
	readonly installedTeamIds: readonly string[];
}

export function pluginAgentPresetKey(pluginId: string, agentId: string): string {
	return `agent:${pluginId}:${agentId}`;
}

export function pluginTeamPresetKey(pluginId: string, teamId: string): string {
	return `team:${pluginId}:${teamId}`;
}

/**
 * 把插件贡献的智能体与团队铺进用户的 Agent 配置。
 *
 * 判定依据是「这个预设有没有铺过」，不是「文档里缺不缺」——后者分不清「还没铺过」和
 * 「铺过但用户删了」，会让用户删掉的档案每次启动复活一遍。
 *
 * 返回 undefined 表示没有任何改动，调用方就不必写盘。
 */
export function backfillPluginAgentPresets(input: PluginPresetBackfillInput): PluginPresetBackfillResult | undefined {
	const now = input.now?.() ?? Date.now();
	const installed = new Set(input.installedPresetIds);
	const agents = [...input.document.agents];
	const teams = [...input.document.teams];
	const agentIds = new Set(agents.map((agent) => agent.id));
	const handles = new Set(
		agents
			.filter((agent) => agent.scope.kind === "library")
			.map((agent) => normalizeMentionHandle(agent.mentionHandle)),
	);
	const installedAgentIds: string[] = [];
	const installedTeamIds: string[] = [];

	for (const preset of input.agents) {
		const key = pluginAgentPresetKey(preset.pluginId, preset.agentId);
		if (installed.has(key)) continue;
		const id = pluginAgentProfileId(preset.pluginId, preset.agentId);
		if (agentIds.has(id)) {
			// 档案已经在了（多半是上个版本铺的但没记上），补记一笔即可。
			installed.add(key);
			continue;
		}
		const mentionHandle = allocateHandle(preset.mentionHandle, handles);
		agents.push({
			id,
			revision: 1,
			name: preset.profileName,
			description: preset.profileDescription,
			mentionHandle,
			blueprintId: preset.blueprint.id,
			// 不落 systemPrompt：留空才能让插件升级人设时，没手改过的用户自动跟上。
			abilities: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] },
			scope: { kind: "library" },
			createdAt: now,
			updatedAt: now,
		});
		agentIds.add(id);
		installed.add(key);
		installedAgentIds.push(id);
	}

	const teamIds = new Set(teams.map((team) => team.id));
	for (const preset of input.teams) {
		const key = pluginTeamPresetKey(preset.pluginId, preset.teamId);
		if (installed.has(key)) continue;
		const id = pluginTeamId(preset.pluginId, preset.teamId);
		if (teamIds.has(id)) {
			installed.add(key);
			continue;
		}
		const members = resolveTeamMembers(preset, agents, agentIds);
		if (!members) {
			// 引用不到的成员会让整份配置在 assertTeamInvariants 处读废，宁可这次不发这支团队。
			// 刻意不记进 installed：用户把缺的成员补回来后，下次启动这支团队就能到位。
			continue;
		}
		teams.push({
			id,
			revision: 1,
			name: preset.name,
			description: preset.description,
			leaderMemberId: members[0]!.id,
			members,
			orchestrationPolicyId: "leader-delegates-v1",
			contextPolicyId: "public-results-v1",
			createdAt: now,
			updatedAt: now,
		});
		teamIds.add(id);
		installed.add(key);
		installedTeamIds.push(id);
	}

	const changed = installedAgentIds.length > 0 || installedTeamIds.length > 0;
	if (!changed && installed.size === input.installedPresetIds.length) return undefined;

	return {
		document: changed ? { ...input.document, revision: input.document.revision + 1, agents, teams } : input.document,
		installedPresetIds: [...installed].sort(),
		installedAgentIds,
		installedTeamIds,
	};
}

function resolveTeamMembers(
	preset: PluginTeamPreset,
	agents: readonly AgentProfile[],
	agentIds: ReadonlySet<string>,
): TeamMember[] | undefined {
	const members: TeamMember[] = [];
	const handles = new Set<string>();
	for (const [index, member] of preset.members.entries()) {
		const agentProfileId = member.builtinKey
			? BUILTIN_AGENT_PROFILE_IDS[member.builtinKey]
			: agents.find((agent) => agent.blueprintId === member.blueprintId)?.id;
		if (!agentProfileId || !agentIds.has(agentProfileId)) return undefined;
		const profile = agents.find((agent) => agent.id === agentProfileId);
		if (!profile) return undefined;
		const handle = allocateHandle(profile.mentionHandle, handles);
		members.push({
			id: pluginTeamMemberId(preset.pluginId, preset.teamId, index),
			handle,
			binding: { kind: "reference", agentProfileId },
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
