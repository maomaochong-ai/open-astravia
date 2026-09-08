import { describe, expect, it } from "vitest";
import {
	assertTeamInvariants,
	createAgentTeamFixture,
	createEmptyAgentTeamDocument,
	findAgentBlueprint,
	INITIAL_AGENT_PROFILES,
	INITIAL_AGENT_TEAM_ID,
	INITIAL_AGENT_TEAMS,
} from "../src/index.js";

describe("Agent Team initial resources", () => {
	it("creates ready-to-use ordinary teams whose agents inherit all abilities", () => {
		const document = createAgentTeamFixture();

		expect(document.teams.map((team) => team.id)).toContain(INITIAL_AGENT_TEAM_ID);
		expect(document.agents).toHaveLength(INITIAL_AGENT_PROFILES.length);
		expect(document.agents.every((agent) => agent.abilities.selectionMode === "all")).toBe(true);
		expect(document.agents.every((agent) => !agent.id.includes(":"))).toBe(true);
		expect(document.teams.every((team) => !team.id.includes(":"))).toBe(true);
		for (const team of document.teams) assertTeamInvariants(team, document.agents);
	});

	it("backs every initial agent with a registered blueprint", () => {
		for (const agent of INITIAL_AGENT_PROFILES) expect(findAgentBlueprint(agent.blueprintId)).toBeDefined();
	});

	it("assembles every team as one Master leading at least two workers", () => {
		const masterId = INITIAL_AGENT_PROFILES.find((agent) => agent.blueprintId === "master")?.id;
		expect(masterId).toBeDefined();
		for (const team of INITIAL_AGENT_TEAMS) {
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
