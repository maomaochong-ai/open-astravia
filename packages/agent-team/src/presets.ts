import type { AgentProfile, AgentTeamDocument, TeamDefinition } from "./contracts.js";
import { AGENT_TEAM_SCHEMA_VERSION } from "./contracts.js";

export const AGENT_TEAM_PRESET_VERSION = 1 as const;
export const DEFAULT_AGENT_TEAM_ID = "builtin:team:vetta";

const PRESET_DEFINITIONS = [
	{
		id: "builtin:agent:leader",
		presetId: "leader",
		name: "Vetta",
		description: "Coordinates the team and owns the final response.",
		handle: "vetta",
		blueprintId: "leader",
	},
	{
		id: "builtin:agent:researcher",
		presetId: "researcher",
		name: "Research",
		description: "Finds evidence and verifies facts.",
		handle: "research",
		blueprintId: "researcher",
	},
	{
		id: "builtin:agent:builder",
		presetId: "builder",
		name: "Build",
		description: "Implements and verifies maintainable changes.",
		handle: "build",
		blueprintId: "builder",
	},
	{
		id: "builtin:agent:reviewer",
		presetId: "reviewer",
		name: "Review",
		description: "Checks correctness, safety, and regressions.",
		handle: "review",
		blueprintId: "reviewer",
	},
] as const;

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

const DEFAULT_TEAM_MEMBERS = PRESET_DEFINITIONS.map((preset) => ({
	id: `builtin:member:${preset.presetId}`,
	handle: preset.handle,
	binding: {
		kind: "reference" as const,
		agentProfileId: preset.id,
	},
}));

export const DEFAULT_AGENT_TEAM: TeamDefinition = Object.freeze({
	id: DEFAULT_AGENT_TEAM_ID,
	revision: 1,
	name: "Vetta Team",
	description: "A ready-to-use team for coordination, research, implementation, and review.",
	leaderMemberId: "builtin:member:leader",
	members: Object.freeze(DEFAULT_TEAM_MEMBERS.map((member) => Object.freeze(member))),
	orchestrationPolicyId: "leader-delegates-v1",
	contextPolicyId: "public-results-v1",
	createdAt: 0,
	updatedAt: 0,
});

/** Test-only fixture retained outside the Desktop runtime file source. */
export function createAgentTeamFixture(): AgentTeamDocument {
	return {
		schemaVersion: AGENT_TEAM_SCHEMA_VERSION,
		presetVersion: AGENT_TEAM_PRESET_VERSION,
		revision: 1,
		agents: BUILTIN_AGENT_PRESETS.map(clonePresetProfile),
		teams: [cloneDefaultTeam()],
	};
}

export function seedAgentTeamPresets(document: AgentTeamDocument): AgentTeamDocument {
	if ((document.presetVersion ?? 0) >= AGENT_TEAM_PRESET_VERSION) return document;
	const agentIds = new Set(document.agents.map((agent) => agent.id));
	const agents = [
		...document.agents,
		...BUILTIN_AGENT_PRESETS.filter((agent) => !agentIds.has(agent.id)).map(clonePresetProfile),
	];
	const teams = document.teams.some((team) => team.id === DEFAULT_AGENT_TEAM_ID)
		? document.teams
		: [...document.teams, cloneDefaultTeam()];
	return {
		...document,
		presetVersion: AGENT_TEAM_PRESET_VERSION,
		revision: document.revision + 1,
		agents,
		teams,
	};
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

function cloneDefaultTeam(): TeamDefinition {
	return {
		...DEFAULT_AGENT_TEAM,
		members: DEFAULT_AGENT_TEAM.members.map((member) => ({
			...member,
			binding: { ...member.binding },
		})),
	};
}
