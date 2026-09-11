import { describe, expect, it } from "vitest";
import {
	assertTeamInvariants,
	createAgentTeamFixture,
	createEmptyAgentTeamDocument,
	INITIAL_AGENT_PROFILES,
	INITIAL_AGENT_TEAM_ID,
	INITIAL_AGENT_TEAMS,
} from "../src/index.js";

describe("Agent Team fixtures", () => {
	it("builds a document that satisfies the same invariants as user data", () => {
		const document = createAgentTeamFixture();

		expect(document.teams.map((team) => team.id)).toContain(INITIAL_AGENT_TEAM_ID);
		expect(document.agents).toHaveLength(INITIAL_AGENT_PROFILES.length);
		expect(document.agents.every((agent) => agent.abilities.selectionMode === "all")).toBe(true);
		expect(document.agents.every((agent) => !agent.id.includes(":"))).toBe(true);
		expect(document.teams.every((team) => !team.id.includes(":"))).toBe(true);
		for (const team of document.teams) assertTeamInvariants(team, document.agents);
	});

	it("carries no provider stamp, so it stands for user-owned resources", () => {
		// 提供方的戳只由回填盖上；夹具代表用户自己的数据，删改都该被允许。
		const document = createAgentTeamFixture();
		expect(document.agents.every((agent) => agent.source === undefined)).toBe(true);
		expect(document.teams.every((team) => team.source === undefined)).toBe(true);
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
