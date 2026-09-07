import { describe, expect, it } from "vitest";
import {
	AGENT_TEAM_PRESET_VERSION,
	assertTeamInvariants,
	BUILTIN_AGENT_PRESETS,
	BUILTIN_AGENT_TEAMS,
	createAgentTeamFixture,
	createEmptyAgentTeamDocument,
	DEFAULT_AGENT_TEAM_ID,
	findAgentBlueprint,
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

	it("keeps an empty document available for new file repositories", () => {
		expect(createEmptyAgentTeamDocument()).toEqual({
			schemaVersion: 1,
			revision: 0,
			agents: [],
			teams: [],
		});
	});
});
