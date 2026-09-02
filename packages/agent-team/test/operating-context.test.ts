import { describe, expect, it } from "vitest";
import { buildTeamOperatingContext, type TeamRosterSnapshot } from "../src/index.js";

const roster: TeamRosterSnapshot = {
	teamId: "team",
	teamName: "Product Team",
	teamRevision: 1,
	leaderParticipantId: "leader",
	members: [
		{
			participantId: "leader",
			handle: "lead",
			displayName: "Lead",
			isLeader: true,
			role: "leader",
			responsibilitySummary: "Coordinate delivery",
			capabilities: [],
			availability: "idle",
			profileRevision: 1,
		},
		{
			participantId: "builder",
			handle: "builder",
			displayName: "Builder",
			isLeader: false,
			role: "builder",
			responsibilitySummary: "Implement changes",
			capabilities: [],
			availability: "idle",
			profileRevision: 1,
		},
	],
};

describe("buildTeamOperatingContext", () => {
	it("keeps the shared roster prefix identical and puts identity after it", () => {
		const leader = buildTeamOperatingContext(roster, "leader", "Lead the work.");
		const builder = buildTeamOperatingContext(roster, "builder", "Build the work.");
		const boundary = "</agent_team_operating_context>";

		expect(leader.slice(0, leader.indexOf(boundary) + boundary.length)).toBe(
			builder.slice(0, builder.indexOf(boundary) + boundary.length),
		);
		expect(leader).toContain("A subagent is a temporary private helper");
		expect(builder).toContain("You are @builder");
	});
});
