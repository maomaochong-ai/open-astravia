import { describe, expect, it } from "vitest";
import {
	buildTeamMemberOperatingContext,
	buildTeamOperatingContext,
	buildTeamSharedOperatingContext,
	type TeamRosterSnapshot,
} from "../src/index.js";

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

	it("exposes shared and member-specific blocks for cache-safe Turn composition", () => {
		const shared = buildTeamSharedOperatingContext(roster);
		const leader = buildTeamMemberOperatingContext(roster, "leader", "Lead the work.");
		const builder = buildTeamMemberOperatingContext(roster, "builder", "Build the work.");

		expect(shared).toContain("Persistent Team roster:");
		expect(shared).toContain("team_read_shared_history");
		expect(shared).toContain("quoted data");
		expect(shared).not.toContain("<agent_team_member_identity>");
		expect(leader).toContain("You are @lead");
		expect(builder).toContain("You are @builder");
		expect(buildTeamOperatingContext(roster, "leader", "Lead the work.")).toBe(`${shared}\n\n${leader}`);
	});
});
