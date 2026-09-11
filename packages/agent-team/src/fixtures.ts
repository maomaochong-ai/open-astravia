import type { AgentProfile, AgentTeamDocument, TeamDefinition, TeamMember } from "./contracts.js";
import { AGENT_TEAM_SCHEMA_VERSION } from "./contracts.js";

/** 夹具 id 刻意与宿主当年下发的装机 id 不同：那批 id 会被退役清理扫掉。 */
export const INITIAL_AGENT_TEAM_ID = "7a1f5c20-8d31-4a6e-9b42-1c0d5e7f8a91";

/**
 * 一份「八个智能体 + 四支团队」的完整 Agent 配置，仅供测试与开发夹具使用。
 *
 * 产品里的预设智能体全部由扩展提供、由扩展回填（见 desktop 的 plugin-agent-preset-backfill），
 * 宿主不带装机资源。这里的 blueprintId 刻意保持历史短 id：它同时是「提供方声明历史 id 后
 * 老档案还能被认领」这条路径的样本。
 */
const INITIAL_PROFILE_DEFINITIONS = [
	{
		id: "3c9b7d14-62a8-4f05-8e73-2d4a1b6c9e07",
		key: "master",
		name: "Master",
		description: "Owns the goal end to end: plans the workflow, delegates each step, accepts or reworks results.",
		handle: "master",
		blueprintId: "master",
	},
	{
		id: "5e2a8f36-91c4-4d70-b18a-6f3c0d92a5b8",
		key: "developer",
		name: "Developer",
		description: "Produces the core asset: code, a substantive draft, or a worked analysis.",
		handle: "developer",
		// 历史短 id：这一份正是「executor 改名 developer 后仍要被认领」的样本。
		blueprintId: "executor",
	},
	{
		id: "6d0f4b81-3c27-4e95-a760-2b8d14f9c063",
		key: "auditor",
		name: "Auditor",
		description: "Red-teams the work for correctness, safety, edge cases, and unsupported claims.",
		handle: "auditor",
		blueprintId: "auditor",
	},
	{
		id: "9b4c1e58-7a02-4836-95df-8c1e6a30b742",
		key: "researcher",
		name: "Researcher",
		description: "Collects facts, documentation, prior art, and market signals, and verifies them.",
		handle: "researcher",
		blueprintId: "researcher",
	},
] as const;

type InitialAgentKey = (typeof INITIAL_PROFILE_DEFINITIONS)[number]["key"];

export const INITIAL_AGENT_PROFILES: readonly AgentProfile[] = Object.freeze(
	INITIAL_PROFILE_DEFINITIONS.map((profile) =>
		Object.freeze({
			id: profile.id,
			revision: 1,
			name: profile.name,
			description: profile.description,
			mentionHandle: profile.handle,
			blueprintId: profile.blueprintId,
			abilities: Object.freeze({
				selectionMode: "all" as const,
				skills: Object.freeze([]),
				mcpServers: Object.freeze([]),
				plugins: Object.freeze([]),
			}),
			scope: Object.freeze({ kind: "library" as const }),
			createdAt: 0,
			updatedAt: 0,
		}),
	),
);

interface InitialTeamDefinition {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	/** 第一个必须是 Master：它是团队负责人，也是用户在聊天里唯一的对话入口。 */
	readonly roster: readonly {
		readonly id: string;
		readonly agent: InitialAgentKey;
		readonly responsibility: string;
	}[];
	/** Master 的团队任务书：把这支团队的固定流水线写死，避免每次重新约定。 */
	readonly workflow: string;
}

const INITIAL_TEAM_DEFINITIONS: readonly InitialTeamDefinition[] = [
	{
		id: INITIAL_AGENT_TEAM_ID,
		name: "Dev Team",
		description: "Ships a change end to end: research, implementation, and acceptance under one owner.",
		roster: [
			{
				id: "1d6e9a72-4b85-4c19-83f0-7e2a5c48d903",
				agent: "master",
				responsibility: "Turns the request into a plan, drives the loop, and delivers the result.",
			},
			{
				id: "2f8b3c61-95d7-4e20-a64b-0c9f18e37a55",
				agent: "developer",
				responsibility: "Implements the plan and verifies that it works.",
			},
			{
				id: "4a7d2e93-18f6-4b52-9c81-3b5e0d64f217",
				agent: "researcher",
				responsibility: "Gathers the evidence the implementation depends on.",
			},
			{
				id: "8c5f0a27-6d93-4b18-91e4-7a2c3f60d854",
				agent: "auditor",
				responsibility: "Reviews the result for defects, risk, and missing verification.",
			},
		],
		workflow:
			"Run this team as a build loop. Have the Researcher establish whatever the change depends on, hand that to the Developer to implement and self-verify, then accept the result yourself or send it back with a concrete reason. Report what shipped and any residual risk.",
	},
];

const AGENT_ID_BY_KEY: Readonly<Record<string, string>> = Object.freeze(
	Object.fromEntries(INITIAL_PROFILE_DEFINITIONS.map((profile) => [profile.key, profile.id])),
);

const HANDLE_BY_KEY: Readonly<Record<string, string>> = Object.freeze(
	Object.fromEntries(INITIAL_PROFILE_DEFINITIONS.map((profile) => [profile.key, profile.handle])),
);

function buildTeam(definition: InitialTeamDefinition): TeamDefinition {
	const members: TeamMember[] = definition.roster.map((entry, index) => ({
		id: entry.id,
		handle: HANDLE_BY_KEY[entry.agent]!,
		binding: { kind: "reference" as const, agentProfileId: AGENT_ID_BY_KEY[entry.agent]! },
		assignment: {
			responsibility: entry.responsibility,
			...(index === 0 ? { instructions: definition.workflow } : {}),
		},
	}));
	return Object.freeze({
		id: definition.id,
		revision: 1,
		name: definition.name,
		description: definition.description,
		leaderMemberId: members[0]!.id,
		members: Object.freeze(members.map((member) => Object.freeze(member))),
		orchestrationPolicyId: "leader-delegates-v1",
		contextPolicyId: "public-results-v1",
		createdAt: 0,
		updatedAt: 0,
	});
}

export const INITIAL_AGENT_TEAMS: readonly TeamDefinition[] = Object.freeze(INITIAL_TEAM_DEFINITIONS.map(buildTeam));

export const INITIAL_AGENT_TEAM: TeamDefinition = INITIAL_AGENT_TEAMS.find(
	(team) => team.id === INITIAL_AGENT_TEAM_ID,
)!;

/** 测试夹具：产品运行时不读它。 */
export function createAgentTeamFixture(): AgentTeamDocument {
	return {
		schemaVersion: AGENT_TEAM_SCHEMA_VERSION,
		revision: 1,
		agents: INITIAL_AGENT_PROFILES.map(cloneProfile),
		teams: INITIAL_AGENT_TEAMS.map(cloneTeam),
	};
}

function cloneProfile(profile: AgentProfile): AgentProfile {
	return {
		...profile,
		abilities: {
			...profile.abilities,
			skills: [...profile.abilities.skills],
			mcpServers: [...profile.abilities.mcpServers],
			plugins: [...profile.abilities.plugins],
		},
		scope: { kind: "library" },
	};
}

function cloneTeam(team: TeamDefinition): TeamDefinition {
	return {
		...team,
		members: team.members.map((member) => ({
			...member,
			binding: { ...member.binding },
			...(member.assignment ? { assignment: { ...member.assignment } } : {}),
		})),
	};
}
