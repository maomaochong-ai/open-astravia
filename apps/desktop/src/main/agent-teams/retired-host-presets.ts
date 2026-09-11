import type { AgentProfile, AgentTeamDocument, TeamDefinition } from "@vetta/agent-team";

/**
 * 宿主当年随包铺下的装机档案 id。
 *
 * 人设已经全部移交扩展，这批档案里只有被扩展认领的那几份还活着（认领时会盖上提供方的戳），
 * 其余的 blueprint 永远解析不到，留着就是一列点不动的死档案。id 写死在这里是因为它们是宿主
 * 自己的历史，不是任何扩展的知识。
 */
const RETIRED_AGENT_PROFILE_IDS: ReadonlySet<string> = new Set([
	"be72a2d2-5463-4d20-9ac2-3fd78e9fbb2e", // Master
	"2fef0dcb-7798-4060-8694-f34b74696d0a", // Researcher
	"934d1f05-1093-4d56-94a1-00642d7eaab6", // Architect
	"d9e51357-04b8-481d-af80-a08e1a362322", // Executor
	"2680428f-7e1e-46e4-9d54-7a841ac3cbd5", // Auditor
	"c0a9ab1e-059f-40dd-91d7-92a6f1e8d52c", // Optimizer
	"6d8baef0-b15d-43a1-8f25-826eae651779", // Synthesizer
	"f162c69d-fc73-443d-af31-b53a1563f43c", // Translator
]);

/** 同上，宿主当年随包铺下的四支团队。新的预设团队由扩展铺，id 与它们不同。 */
const RETIRED_TEAM_IDS: ReadonlySet<string> = new Set([
	"2f631500-0d58-4458-a595-9e403affa08e", // Dev Team
	"9c975a15-1a00-4b1d-b646-0c1d76c43e3c", // Deep Research
	"742016f1-0f8b-4d9f-a86b-6863ed6cb58a", // Growth & Content
	"6efa6897-3e38-499c-92b4-ceeb5725b069", // Biz Strategy
]);

/**
 * 清掉宿主留下的装机残骸，只跑一次。
 *
 * 必须在扩展回填之后跑：被扩展接管的角色那时已经盖上提供方的戳，这里据此放过它们，用户改过的
 * 名字、@handle 与能力也就一并留住。用户自建的资源永远不动；只有引用了被清理档案的成员会被摘掉
 * ——那种成员本来也已经跑不起来。
 *
 * 返回 undefined 表示没有任何改动。
 */
export function dropRetiredHostPresets(
	document: AgentTeamDocument,
	now: number = Date.now(),
): AgentTeamDocument | undefined {
	const removedAgentIds = new Set(
		document.agents
			.filter((agent) => RETIRED_AGENT_PROFILE_IDS.has(agent.id) && !agent.source)
			.map((agent) => agent.id),
	);
	const removedTeamIds = new Set(
		document.teams.filter((team) => RETIRED_TEAM_IDS.has(team.id)).map((team) => team.id),
	);
	if (removedAgentIds.size === 0 && removedTeamIds.size === 0) return undefined;

	const teams: TeamDefinition[] = [];
	for (const team of document.teams) {
		if (removedTeamIds.has(team.id)) continue;
		const members = team.members.filter((member) => !removedAgentIds.has(member.binding.agentProfileId));
		if (members.length === team.members.length) {
			teams.push(team);
			continue;
		}
		if (members.length === 0) {
			// 整支队都指向被清理的档案，留一个空壳没有意义。
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
			updatedAt: now,
		});
	}

	const agents: AgentProfile[] = document.agents.filter(
		(agent) =>
			!removedAgentIds.has(agent.id) && !(agent.scope.kind === "team" && removedTeamIds.has(agent.scope.teamId)),
	);

	return { ...document, revision: document.revision + 1, agents, teams };
}
