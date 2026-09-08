import type { AgentProfile, AgentTeamDocument, TeamDefinition, TeamMember } from "./contracts.js";
import { AGENT_TEAM_SCHEMA_VERSION } from "./contracts.js";
import { normalizeMentionHandle } from "./domain.js";

export const AGENT_TEAM_PRESET_VERSION = 2 as const;
export const DEFAULT_AGENT_TEAM_ID = "builtin:team:dev";

/**
 * 全局 Agent 池：一个 Master 加七种 Worker，与 `BUILTIN_AGENT_BLUEPRINTS` 一一对应。
 * 预设团队一律按「1 Master + N Workers」组装，用户自建团队时照抄这个公式即可。
 */
const PRESET_DEFINITIONS = [
	{
		id: "builtin:agent:master",
		presetId: "master",
		name: "Master",
		description: "Owns the goal end to end: plans the workflow, delegates each step, accepts or reworks results.",
		handle: "master",
		blueprintId: "master",
	},
	{
		id: "builtin:agent:researcher",
		presetId: "researcher",
		name: "Researcher",
		description: "Collects facts, documentation, prior art, and market signals, and verifies them.",
		handle: "researcher",
		blueprintId: "researcher",
	},
	{
		id: "builtin:agent:architect",
		presetId: "architect",
		name: "Architect",
		description: "Designs the technical architecture, interface contracts, or the outline of a document or PRD.",
		handle: "architect",
		blueprintId: "architect",
	},
	{
		id: "builtin:agent:executor",
		presetId: "executor",
		name: "Executor",
		description: "Produces the core asset: code, a substantive draft, or a worked analysis.",
		handle: "executor",
		blueprintId: "executor",
	},
	{
		id: "builtin:agent:auditor",
		presetId: "auditor",
		name: "Auditor",
		description: "Red-teams the work for correctness, safety, edge cases, and unsupported claims.",
		handle: "auditor",
		blueprintId: "auditor",
	},
	{
		id: "builtin:agent:optimizer",
		presetId: "optimizer",
		name: "Optimizer",
		description: "Refines finished work: performance, maintainability, and channel-specific voice.",
		handle: "optimizer",
		blueprintId: "optimizer",
	},
	{
		id: "builtin:agent:synthesizer",
		presetId: "synthesizer",
		name: "Synthesizer",
		description: "Merges results from several members into one consistent report or deliverable bundle.",
		handle: "synthesizer",
		blueprintId: "synthesizer",
	},
	{
		id: "builtin:agent:translator",
		presetId: "translator",
		name: "Translator",
		description: "Localizes across languages and restates technical detail in business language.",
		handle: "translator",
		blueprintId: "translator",
	},
] as const;

type PresetAgentKey = (typeof PRESET_DEFINITIONS)[number]["presetId"];

export const BUILTIN_AGENT_PRESETS: readonly AgentProfile[] = Object.freeze(
	PRESET_DEFINITIONS.map((preset) =>
		Object.freeze({
			id: preset.id,
			revision: 1,
			name: preset.name,
			description: preset.description,
			mentionHandle: preset.handle,
			blueprintId: preset.blueprintId,
			presetId: preset.presetId,
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

interface TeamPresetDefinition {
	readonly id: string;
	readonly slug: string;
	readonly name: string;
	readonly description: string;
	/** 第一个必须是 Master：它是团队负责人，也是用户在聊天里唯一的对话入口。 */
	readonly roster: readonly { readonly agent: PresetAgentKey; readonly responsibility: string }[];
	/** Master 的团队任务书：把这支团队的固定流水线写死，避免每次重新约定。 */
	readonly workflow: string;
}

const TEAM_PRESET_DEFINITIONS: readonly TeamPresetDefinition[] = [
	{
		id: DEFAULT_AGENT_TEAM_ID,
		slug: "dev",
		name: "Dev Team",
		description: "Ships a change end to end: design, implementation, and review under one owner.",
		roster: [
			{
				agent: "master",
				responsibility: "Turns the request into a plan, drives the loop, and delivers the result.",
			},
			{ agent: "architect", responsibility: "Designs the approach and the contracts before any code is written." },
			{ agent: "executor", responsibility: "Implements the design and verifies that it works." },
			{
				agent: "auditor",
				responsibility: "Reviews the implementation for defects, risk, and missing verification.",
			},
		],
		workflow:
			"Run this team as a build loop. First have the Architect turn the request into a concrete approach: the contracts to honour, the files or components in scope, and the trade-offs taken. Hand that design to the Executor to implement and self-verify. Send the result to the Auditor for review. Accept only when the Auditor reports no blocking finding; otherwise decide whether the fix belongs to the Executor or the design needs to go back to the Architect, and run the loop again. Report the design decision, what shipped, and any residual risk.",
	},
	{
		id: "builtin:team:research",
		slug: "research",
		name: "Deep Research",
		description: "Investigates a question, strips out hallucinations, and returns a sourced report.",
		roster: [
			{ agent: "master", responsibility: "Breaks the question into angles and signs off on the final report." },
			{ agent: "researcher", responsibility: "Gathers evidence for each angle and records where it came from." },
			{ agent: "auditor", responsibility: "Removes unsupported claims and challenges weak evidence." },
			{ agent: "synthesizer", responsibility: "Turns the surviving findings into one structured report." },
		],
		workflow:
			"Run this team as a research pipeline. Break the question into independent angles and dispatch them to the Researcher together rather than one at a time. Pass the collected evidence to the Auditor to strip unsupported claims and flag weak sourcing; commission more research for whatever the Auditor knocks out. Once the evidence holds, have the Synthesizer assemble a structured report. Deliver it with your own summary of what is now known, what remains uncertain, and what it implies.",
	},
	{
		id: "builtin:team:growth",
		slug: "growth",
		name: "Growth & Content",
		description: "Takes a campaign from angle research to a master draft and per-channel variants.",
		roster: [
			{ agent: "master", responsibility: "Sets the campaign angle and assembles the final publishing package." },
			{ agent: "researcher", responsibility: "Finds the trends, audience signals, and references worth riding." },
			{ agent: "executor", responsibility: "Writes the master draft that every channel variant derives from." },
			{ agent: "optimizer", responsibility: "Adapts the master draft into each channel's voice and format." },
		],
		workflow:
			"Run this team as a content pipeline. Decide the campaign angle first, then have the Researcher surface current trends, audience signals, and references. Brief the Executor to write one master draft that carries the message. Hand it to the Optimizer to produce a variant per target channel, naming each channel explicitly so tone and length match it. Deliver the master draft plus the variants as one publishing package, and say which channel leads.",
	},
	{
		id: "builtin:team:strategy",
		slug: "strategy",
		name: "Biz Strategy",
		description: "Builds a business case, stress-tests it for fatal flaws, and packages the plan.",
		roster: [
			{ agent: "master", responsibility: "Frames the business goal and owns the delivered plan." },
			{ agent: "architect", responsibility: "Builds the PRD structure and the business model behind it." },
			{ agent: "auditor", responsibility: "Hunts for fatal flaws in the model, the economics, and the risks." },
			{ agent: "synthesizer", responsibility: "Packages the reviewed material into a presentable plan." },
		],
		workflow:
			"Run this team as a business case loop. Frame the goal, the market, and the constraints, then have the Architect build the PRD structure and the business model that supports it. Send it to the Auditor to hunt for fatal flaws: unit economics that do not close, unvalidated assumptions, regulatory and competitive risk. Feed blocking findings back to the Architect until the case stands. Then have the Synthesizer package the reviewed material into a presentable plan, and deliver it with your own read on the decision it supports.",
	},
];

const AGENT_ID_BY_KEY: Readonly<Record<string, string>> = Object.freeze(
	Object.fromEntries(PRESET_DEFINITIONS.map((preset) => [preset.presetId, preset.id])),
);

const HANDLE_BY_KEY: Readonly<Record<string, string>> = Object.freeze(
	Object.fromEntries(PRESET_DEFINITIONS.map((preset) => [preset.presetId, preset.handle])),
);

function buildTeam(definition: TeamPresetDefinition): TeamDefinition {
	const members: TeamMember[] = definition.roster.map((entry, index) => ({
		id: `builtin:member:${definition.slug}:${entry.agent}`,
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

export const BUILTIN_AGENT_TEAMS: readonly TeamDefinition[] = Object.freeze(TEAM_PRESET_DEFINITIONS.map(buildTeam));

export const DEFAULT_AGENT_TEAM: TeamDefinition = BUILTIN_AGENT_TEAMS.find(
	(team) => team.id === DEFAULT_AGENT_TEAM_ID,
)!;

/** Test-only fixture retained outside the Desktop runtime file source. */
export function createAgentTeamFixture(): AgentTeamDocument {
	return {
		schemaVersion: AGENT_TEAM_SCHEMA_VERSION,
		presetVersion: AGENT_TEAM_PRESET_VERSION,
		revision: 1,
		agents: BUILTIN_AGENT_PRESETS.map(clonePresetProfile),
		teams: BUILTIN_AGENT_TEAMS.map(cloneTeam),
	};
}

/**
 * 上一代内置预设：改版后一律退役。键是旧 Agent id，值是接替它的新预设——
 * 用户自建的团队可能已经把旧 Agent 编进名册，改绑到接替者比把成员踢掉更少破坏。
 */
const RETIRED_AGENT_SUCCESSORS: Readonly<Record<string, string>> = Object.freeze({
	"builtin:agent:leader": "builtin:agent:master",
	"builtin:agent:builder": "builtin:agent:executor",
	"builtin:agent:reviewer": "builtin:agent:auditor",
});

const RETIRED_TEAM_IDS: ReadonlySet<string> = new Set(["builtin:team:vetta"]);

/**
 * 把存量配置迁到当前这套预设：内置的整批换新，用户自建的原样保留。
 *
 * 内置预设是**重置**而不是「缺则补」：留着上一代的档案，用户会同时看到新旧两套角色，
 * 而旧档案里物化的提示词还会被当成显式覆盖，永远锁死在上一代文案上。
 * 挂在退役团队下的历史会话不会被删，但界面上不再列出——退役是用户明确要的。
 */
export function seedAgentTeamPresets(document: AgentTeamDocument): AgentTeamDocument {
	if ((document.presetVersion ?? 0) >= AGENT_TEAM_PRESET_VERSION) return document;
	const presetAgentIds = new Set(BUILTIN_AGENT_PRESETS.map((agent) => agent.id));
	const retiredAgentIds = new Set(Object.keys(RETIRED_AGENT_SUCCESSORS));
	const keptAgents = document.agents.filter(
		(agent) => !presetAgentIds.has(agent.id) && !retiredAgentIds.has(agent.id),
	);
	// 用户可能已经占用了 master / auditor 之类的 handle，撞车会让整份配置校验不过。
	const takenHandles = new Set(
		keptAgents
			.filter((agent) => agent.scope.kind === "library")
			.map((agent) => normalizeMentionHandle(agent.mentionHandle)),
	);
	const agents = [
		...keptAgents,
		...BUILTIN_AGENT_PRESETS.map((preset) => {
			const profile = clonePresetProfile(preset);
			return { ...profile, mentionHandle: claimHandle(profile.mentionHandle, takenHandles) };
		}),
	];

	const presetTeamIds = new Set(BUILTIN_AGENT_TEAMS.map((team) => team.id));
	const teams = [
		...document.teams
			.filter((team) => !presetTeamIds.has(team.id) && !RETIRED_TEAM_IDS.has(team.id))
			.map(rebindRetiredMembers),
		...BUILTIN_AGENT_TEAMS.map(cloneTeam),
	];

	return {
		...document,
		presetVersion: AGENT_TEAM_PRESET_VERSION,
		revision: document.revision + 1,
		agents,
		teams,
	};
}

function rebindRetiredMembers(team: TeamDefinition): TeamDefinition {
	if (!team.members.some((member) => RETIRED_AGENT_SUCCESSORS[member.binding.agentProfileId])) return team;
	return {
		...team,
		members: team.members.map((member) => {
			const successor = RETIRED_AGENT_SUCCESSORS[member.binding.agentProfileId];
			return successor ? { ...member, binding: { ...member.binding, agentProfileId: successor } } : member;
		}),
	};
}

function claimHandle(preferred: string, taken: Set<string>): string {
	let candidate = preferred;
	for (let suffix = 2; taken.has(normalizeMentionHandle(candidate)); suffix += 1) candidate = `${preferred}-${suffix}`;
	taken.add(normalizeMentionHandle(candidate));
	return candidate;
}

export function isBuiltinAgentPreset(profile: AgentProfile): boolean {
	return profile.presetId !== undefined && BUILTIN_AGENT_PRESETS.some((preset) => preset.id === profile.id);
}

function clonePresetProfile(profile: AgentProfile): AgentProfile {
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
