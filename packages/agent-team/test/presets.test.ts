import { describe, expect, it } from "vitest";
import type { AgentProfile, TeamDefinition } from "../src/index.js";
import {
	AGENT_TEAM_PRESET_VERSION,
	assertTeamInvariants,
	BUILTIN_AGENT_PRESETS,
	BUILTIN_AGENT_TEAMS,
	createAgentTeamFixture,
	createEmptyAgentTeamDocument,
	DEFAULT_AGENT_TEAM_ID,
	findAgentBlueprint,
	seedAgentTeamPresets,
} from "../src/index.js";

describe("Agent Team presets", () => {
	it("creates ready-to-use teams whose agents inherit all abilities", () => {
		const document = createAgentTeamFixture();

		expect(document.presetVersion).toBe(AGENT_TEAM_PRESET_VERSION);
		expect(document.teams.map((team) => team.id)).toContain(DEFAULT_AGENT_TEAM_ID);
		expect(document.agents).toHaveLength(BUILTIN_AGENT_PRESETS.length);
		expect(document.agents.every((agent) => agent.abilities.selectionMode === "all")).toBe(true);
		for (const team of document.teams) assertTeamInvariants(team, document.agents);
	});

	it("backs every preset agent with a registered blueprint", () => {
		for (const agent of BUILTIN_AGENT_PRESETS) expect(findAgentBlueprint(agent.blueprintId)).toBeDefined();
	});

	it("assembles every team as one Master leading at least two workers", () => {
		const masterId = "builtin:agent:master";
		for (const team of BUILTIN_AGENT_TEAMS) {
			const leader = team.members.find((member) => member.id === team.leaderMemberId);
			expect(leader?.binding.agentProfileId).toBe(masterId);
			// Master 的任务书写死这支团队的流水线；worker 只公示职责，不带流程指令。
			expect(leader?.assignment?.instructions).toBeTruthy();
			const workers = team.members.filter((member) => member.id !== team.leaderMemberId);
			expect(workers.length).toBeGreaterThanOrEqual(2);
			expect(workers.every((member) => member.binding.agentProfileId !== masterId)).toBe(true);
			expect(workers.every((member) => member.assignment?.responsibility)).toBe(true);
		}
	});

	it("replaces the previous generation of built-in presets on an existing install", () => {
		const legacy = {
			schemaVersion: 1 as const,
			revision: 6,
			agents: [
				legacyAgent("builtin:agent:leader", "Vetta", "vetta", "leader"),
				legacyAgent("builtin:agent:researcher", "Research", "research", "researcher"),
				legacyAgent("builtin:agent:builder", "Build", "build", "builder"),
				legacyAgent("builtin:agent:reviewer", "Review", "review", "reviewer"),
				legacyAgent("user:agent:own", "Mine", "mine", "builder"),
			],
			teams: [legacyTeam("builtin:team:vetta"), legacyTeam("user:team:own")],
		};

		const migrated = seedAgentTeamPresets(legacy);

		expect(migrated.presetVersion).toBe(AGENT_TEAM_PRESET_VERSION);
		expect(migrated.revision).toBe(7);
		expect(migrated.agents.map((agent) => agent.id)).toEqual([
			"user:agent:own",
			...BUILTIN_AGENT_PRESETS.map((preset) => preset.id),
		]);
		expect(migrated.teams.map((team) => team.id)).toEqual([
			"user:team:own",
			...BUILTIN_AGENT_TEAMS.map((team) => team.id),
		]);
		// 内置预设上一代物化的提示词覆盖必须一并清掉，否则新 blueprint 永远到不了存量用户；
		// 用户自己写的覆盖照旧保留。
		const presetIds = new Set(BUILTIN_AGENT_PRESETS.map((preset) => preset.id));
		expect(
			migrated.agents.filter((agent) => presetIds.has(agent.id)).every((a) => a.systemPrompt === undefined),
		).toBe(true);
		expect(migrated.agents.find((agent) => agent.id === "user:agent:own")?.systemPrompt).toBeTruthy();
		// 用户自建团队里编着的退役 Agent 改绑到接替者，而不是把成员踢出名册。
		expect(migrated.teams[0]?.members[0]?.binding.agentProfileId).toBe("builtin:agent:executor");
		expect(seedAgentTeamPresets(migrated)).toBe(migrated);
	});

	it("keeps a preset handle unique when a user agent already claimed it", () => {
		const migrated = seedAgentTeamPresets({
			schemaVersion: 1 as const,
			revision: 1,
			agents: [legacyAgent("user:agent:own", "Mine", "master", "builder")],
			teams: [],
		});

		const handles = migrated.agents.map((agent) => agent.mentionHandle);
		expect(handles).toContain("master-2");
		expect(new Set(handles).size).toBe(handles.length);
	});

	it("keeps an empty document available for new file repositories", () => {
		expect(createEmptyAgentTeamDocument()).toEqual({
			schemaVersion: 1,
			revision: 0,
			agents: [],
			teams: [],
		});
	});
});

function legacyAgent(id: string, name: string, handle: string, blueprintId: string): AgentProfile {
	return {
		id,
		revision: 1,
		name,
		description: `${name} description`,
		mentionHandle: handle,
		blueprintId,
		// 旧版把 blueprint 默认提示词物化进了档案，迁移必须把它冲掉。
		systemPrompt: "Stale prompt from the previous generation.",
		abilities: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] },
		scope: { kind: "library" },
		createdAt: 0,
		updatedAt: 0,
	};
}

function legacyTeam(id: string): TeamDefinition {
	return {
		id,
		revision: 1,
		name: id,
		description: "",
		leaderMemberId: `${id}:member`,
		members: [
			{
				id: `${id}:member`,
				handle: "build",
				binding: { kind: "reference", agentProfileId: "builtin:agent:builder" },
			},
		],
		orchestrationPolicyId: "leader-delegates-v1",
		contextPolicyId: "public-results-v1",
		createdAt: 0,
		updatedAt: 0,
	};
}
