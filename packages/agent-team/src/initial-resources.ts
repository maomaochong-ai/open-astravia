import type { AgentProfile, AgentTeamDocument, TeamDefinition, TeamMember } from "./contracts.js";
import { AGENT_TEAM_SCHEMA_VERSION } from "./contracts.js";

export const INITIAL_AGENT_TEAM_ID = "2f631500-0d58-4458-a595-9e403affa08e";

/**
 * 内置预设的批次号。每批新增的 Agent / 团队都标上当前号，存量安装靠它判断自己还差哪几批。
 *
 * 只增不改：已经发出去的预设永远留在它当初的批次里，改号会让所有装机目录重新回填一遍。
 */
export const BUILTIN_PRESET_GENERATION = 2;

/**
 * 没有记录过批次号的装机目录一律按第 1 批处理——回填机制上线前铺下去的就是那一批。
 * 用户当时删掉的预设不会因为这次上线被复活，只有之后新增的批次才补。
 */
export const BASELINE_PRESET_GENERATION = 1;

/**
 * 首次安装资源中的 Agent 池：一个 Master 加八种 Worker，与可用 Blueprint 一一对应。
 * 初始团队按「1 Master + N Workers」组装；安装后与用户创建的资源完全相同。
 */
const INITIAL_PROFILE_DEFINITIONS = [
	{
		id: "be72a2d2-5463-4d20-9ac2-3fd78e9fbb2e",
		key: "master",
		name: "Master",
		description: "Owns the goal end to end: plans the workflow, delegates each step, accepts or reworks results.",
		handle: "master",
		blueprintId: "master",
		introducedIn: 1,
	},
	{
		id: "2fef0dcb-7798-4060-8694-f34b74696d0a",
		key: "researcher",
		name: "Researcher",
		description: "Collects facts, documentation, prior art, and market signals, and verifies them.",
		handle: "researcher",
		blueprintId: "researcher",
		introducedIn: 1,
	},
	{
		id: "934d1f05-1093-4d56-94a1-00642d7eaab6",
		key: "architect",
		name: "Architect",
		description: "Designs the technical architecture, interface contracts, or the outline of a document or PRD.",
		handle: "architect",
		blueprintId: "architect",
		introducedIn: 1,
	},
	{
		id: "f29a77b9-e382-4b69-bb23-752f7c0a18fc",
		key: "designer",
		name: "Designer",
		description: "Designs the UI on the Vetta canvas: app screens, landing pages, slides, and posters.",
		handle: "designer",
		blueprintId: "designer",
		introducedIn: BUILTIN_PRESET_GENERATION,
	},
	{
		id: "d9e51357-04b8-481d-af80-a08e1a362322",
		key: "executor",
		name: "Executor",
		description: "Produces the core asset: code, a substantive draft, or a worked analysis.",
		handle: "executor",
		blueprintId: "executor",
		introducedIn: 1,
	},
	{
		id: "2680428f-7e1e-46e4-9d54-7a841ac3cbd5",
		key: "auditor",
		name: "Auditor",
		description: "Red-teams the work for correctness, safety, edge cases, and unsupported claims.",
		handle: "auditor",
		blueprintId: "auditor",
		introducedIn: 1,
	},
	{
		id: "c0a9ab1e-059f-40dd-91d7-92a6f1e8d52c",
		key: "optimizer",
		name: "Optimizer",
		description: "Refines finished work: performance, maintainability, and channel-specific voice.",
		handle: "optimizer",
		blueprintId: "optimizer",
		introducedIn: 1,
	},
	{
		id: "6d8baef0-b15d-43a1-8f25-826eae651779",
		key: "synthesizer",
		name: "Synthesizer",
		description: "Merges results from several members into one consistent report or deliverable bundle.",
		handle: "synthesizer",
		blueprintId: "synthesizer",
		introducedIn: 1,
	},
	{
		id: "f162c69d-fc73-443d-af31-b53a1563f43c",
		key: "translator",
		name: "Translator",
		description: "Localizes across languages and restates technical detail in business language.",
		handle: "translator",
		blueprintId: "translator",
		introducedIn: 1,
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
	/** 首次随哪一批预设发布，见 {@link BUILTIN_PRESET_GENERATION}。 */
	readonly introducedIn: number;
}

const INITIAL_TEAM_DEFINITIONS: readonly InitialTeamDefinition[] = [
	{
		id: INITIAL_AGENT_TEAM_ID,
		name: "Dev Team",
		description: "Ships a change end to end: design, implementation, and review under one owner.",
		roster: [
			{
				id: "5331fb94-0f3a-45c5-9ba1-32048a5067d3",
				agent: "master",
				responsibility: "Turns the request into a plan, drives the loop, and delivers the result.",
			},
			{
				id: "062e9186-ca1a-42d7-9d1d-66731b8ce17b",
				agent: "architect",
				responsibility: "Designs the approach and the contracts before any code is written.",
			},
			{
				id: "09221fe5-ce98-4555-a294-6d78e29b87b4",
				agent: "executor",
				responsibility: "Implements the design and verifies that it works.",
			},
			{
				id: "9c121f61-5f75-4b88-b5fd-188e2924c096",
				agent: "auditor",
				responsibility: "Reviews the implementation for defects, risk, and missing verification.",
			},
		],
		workflow:
			"Run this team as a build loop. First have the Architect turn the request into a concrete approach: the contracts to honour, the files or components in scope, and the trade-offs taken. Hand that design to the Executor to implement and self-verify. Send the result to the Auditor for review. Accept only when the Auditor reports no blocking finding; otherwise decide whether the fix belongs to the Executor or the design needs to go back to the Architect, and run the loop again. Report the design decision, what shipped, and any residual risk.",
		introducedIn: 1,
	},
	{
		id: "d1e099ee-8b1d-4fc4-9ae2-5563318ae6be",
		name: "Design Team",
		description: "Turns a product idea into reviewed screens on the Vetta design canvas.",
		roster: [
			{
				id: "0a77ecba-ef26-44cc-9062-93254d8b4aae",
				agent: "master",
				responsibility: "Frames the design brief, drives the loop, and delivers the design document.",
			},
			{
				id: "519404b7-9b28-4014-9a9a-07a521147fea",
				agent: "architect",
				responsibility: "Defines the screen inventory, flows, and states before anything is drawn.",
			},
			{
				id: "2b620e37-bb6c-469f-a8d4-cea9956f920a",
				agent: "designer",
				responsibility: "Builds the frames on the Vetta canvas and keeps the visual system consistent.",
			},
			{
				id: "a8265c81-0a99-4fbd-9ffd-71f2d555c8b8",
				agent: "auditor",
				responsibility: "Reviews the screens for usability, missing states, and inconsistent visuals.",
			},
		],
		workflow:
			"Run this team as a design loop. Settle the product type and the audience first, then have the Architect lay out the screen inventory, the flows between screens, and the states each one must cover. Hand that to the Designer to build on the Vetta design canvas as a .vetd document, one frame per screen, sharing a single theme and shared components. Send the result to the Auditor to review usability, missing or empty states, and visual inconsistency. Accept only when the Auditor reports no blocking finding; otherwise decide whether the fix belongs to the Designer or the flow needs to go back to the Architect, and run the loop again. Deliver the design document with the decisions behind it and whatever is still open.",
		introducedIn: BUILTIN_PRESET_GENERATION,
	},
	{
		id: "9c975a15-1a00-4b1d-b646-0c1d76c43e3c",
		name: "Deep Research",
		description: "Investigates a question, strips out hallucinations, and returns a sourced report.",
		roster: [
			{
				id: "f3b04ffa-ec1e-441f-94c9-e0c1d50210d8",
				agent: "master",
				responsibility: "Breaks the question into angles and signs off on the final report.",
			},
			{
				id: "c0f153d9-ff73-405e-adf9-cd1526093428",
				agent: "researcher",
				responsibility: "Gathers evidence for each angle and records where it came from.",
			},
			{
				id: "51f36c41-e927-4930-a741-b54db407b87c",
				agent: "auditor",
				responsibility: "Removes unsupported claims and challenges weak evidence.",
			},
			{
				id: "a05ff816-6ee4-4434-b887-128589d582fc",
				agent: "synthesizer",
				responsibility: "Turns the surviving findings into one structured report.",
			},
		],
		workflow:
			"Run this team as a research pipeline. Break the question into independent angles and dispatch them to the Researcher together rather than one at a time. Pass the collected evidence to the Auditor to strip unsupported claims and flag weak sourcing; commission more research for whatever the Auditor knocks out. Once the evidence holds, have the Synthesizer assemble a structured report. Deliver it with your own summary of what is now known, what remains uncertain, and what it implies.",
		introducedIn: 1,
	},
	{
		id: "742016f1-0f8b-4d9f-a86b-6863ed6cb58a",
		name: "Growth & Content",
		description: "Takes a campaign from angle research to a master draft and per-channel variants.",
		roster: [
			{
				id: "c46df2f5-b71e-483b-ab55-850a04810e1a",
				agent: "master",
				responsibility: "Sets the campaign angle and assembles the final publishing package.",
			},
			{
				id: "264190c7-44b6-4d2d-9699-10f28112da0f",
				agent: "researcher",
				responsibility: "Finds the trends, audience signals, and references worth riding.",
			},
			{
				id: "4408eb6d-5d20-46ba-b2df-8ca7e2b90cc1",
				agent: "executor",
				responsibility: "Writes the master draft that every channel variant derives from.",
			},
			{
				id: "0f6eda99-c856-4996-860d-7e30e17f97eb",
				agent: "optimizer",
				responsibility: "Adapts the master draft into each channel's voice and format.",
			},
		],
		workflow:
			"Run this team as a content pipeline. Decide the campaign angle first, then have the Researcher surface current trends, audience signals, and references. Brief the Executor to write one master draft that carries the message. Hand it to the Optimizer to produce a variant per target channel, naming each channel explicitly so tone and length match it. Deliver the master draft plus the variants as one publishing package, and say which channel leads.",
		introducedIn: 1,
	},
	{
		id: "6efa6897-3e38-499c-92b4-ceeb5725b069",
		name: "Biz Strategy",
		description: "Builds a business case, stress-tests it for fatal flaws, and packages the plan.",
		roster: [
			{
				id: "9f6f1b32-300f-4f2a-a55a-f0062bfe73e1",
				agent: "master",
				responsibility: "Frames the business goal and owns the delivered plan.",
			},
			{
				id: "0ee37840-141e-404e-88a4-39e41f56b265",
				agent: "architect",
				responsibility: "Builds the PRD structure and the business model behind it.",
			},
			{
				id: "556cb9e4-52d4-4372-8ff9-cce2525af1e8",
				agent: "auditor",
				responsibility: "Hunts for fatal flaws in the model, the economics, and the risks.",
			},
			{
				id: "e7b8321b-f70b-4d67-a832-6a5d95ff8320",
				agent: "synthesizer",
				responsibility: "Packages the reviewed material into a presentable plan.",
			},
		],
		workflow:
			"Run this team as a business case loop. Frame the goal, the market, and the constraints, then have the Architect build the PRD structure and the business model that supports it. Send it to the Auditor to hunt for fatal flaws: unit economics that do not close, unvalidated assumptions, regulatory and competitive risk. Feed blocking findings back to the Architect until the case stands. Then have the Synthesizer package the reviewed material into a presentable plan, and deliver it with your own read on the decision it supports.",
		introducedIn: 1,
	},
];

/**
 * 内置 Agent 档案的 id，按角色 key 索引。
 *
 * 插件团队引用宿主角色（`builtin:master`）时要解析到这些 id：团队成员绑的是档案 id，
 * 不是 blueprint id。
 */
export const BUILTIN_AGENT_PROFILE_IDS: Readonly<Record<string, string>> = Object.freeze(
	Object.fromEntries(INITIAL_PROFILE_DEFINITIONS.map((profile) => [profile.key, profile.id])),
);

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

const AGENT_GENERATION_BY_ID: Readonly<Record<string, number>> = Object.freeze(
	Object.fromEntries(INITIAL_PROFILE_DEFINITIONS.map((profile) => [profile.id, profile.introducedIn])),
);

const TEAM_GENERATION_BY_ID: Readonly<Record<string, number>> = Object.freeze(
	Object.fromEntries(INITIAL_TEAM_DEFINITIONS.map((team) => [team.id, team.introducedIn])),
);

export interface BuiltinPresetBatch {
	readonly agents: readonly AgentProfile[];
	readonly teams: readonly TeamDefinition[];
}

/**
 * 批次号大于 `generation` 的内置预设，也就是这份装机目录还没收到的那些。
 *
 * 判定只看批次，不看目录里缺什么：用户自己删掉的预设批次号早就记下了，不会被当成「缺失」补回来。
 */
export function builtinPresetsIntroducedAfter(generation: number): BuiltinPresetBatch {
	return {
		agents: INITIAL_AGENT_PROFILES.filter((agent) => (AGENT_GENERATION_BY_ID[agent.id] ?? 1) > generation),
		teams: INITIAL_AGENT_TEAMS.filter((team) => (TEAM_GENERATION_BY_ID[team.id] ?? 1) > generation),
	};
}

/** Test-only fixture retained outside the Desktop runtime file source. */
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
