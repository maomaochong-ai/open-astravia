import { describe, expect, it } from "vitest";
import type { AgentProfile, TeamDefinition } from "../src/contracts.js";
import {
	assertTeamInvariants,
	listLibraryAgentProfiles,
	normalizeMentionHandle,
	previewAgentProfileDelete,
	previewAgentProfileUpdate,
	resolveMentionedMemberIds,
	resolveTeamTargets,
} from "../src/domain.js";

const profile = (id: string, scope: AgentProfile["scope"] = { kind: "library" }): AgentProfile => ({
	id,
	revision: 1,
	name: id,
	description: "",
	mentionHandle: id,
	blueprintId: "leader",
	abilities: { skills: [], mcpServers: [], plugins: [] },
	scope,
	createdAt: 0,
	updatedAt: 0,
});

const team: TeamDefinition = {
	id: "team-1",
	revision: 1,
	name: "Team",
	description: "",
	leaderMemberId: "member-1",
	members: [
		{ id: "member-1", handle: "Leader", binding: { kind: "reference", agentProfileId: "agent-1" } },
		{ id: "member-2", handle: "Researcher", binding: { kind: "reference", agentProfileId: "agent-2" } },
	],
	orchestrationPolicyId: "leader-delegates-v1",
	contextPolicyId: "public-results-v1",
	createdAt: 0,
	updatedAt: 0,
};

describe("Agent Team domain", () => {
	it("normalizes Unicode handles and routes an empty target to the leader", () => {
		expect(normalizeMentionHandle(" @Ｒｅｓｅａｒｃｈｅｒ ")).toBe("researcher");
		expect(resolveTeamTargets(team, [])).toEqual(["member-1"]);
	});

	it("rejects duplicate handles and invalid binding scopes", () => {
		expect(() =>
			assertTeamInvariants(
				{
					...team,
					members: [
						{ ...team.members[0], handle: "same" },
						{ ...team.members[1], handle: "same" },
					],
				},
				[profile("agent-1"), profile("agent-2")],
			),
		).toThrow("Duplicate team member handle");
		expect(() =>
			assertTeamInvariants(
				{
					...team,
					members: [{ id: "member-1", handle: "Leader", binding: { kind: "copy", agentProfileId: "agent-1" } }],
				},
				[profile("agent-1")],
			),
		).toThrow("Copied member profile");
	});

	it("previews only live references", () => {
		const impact = previewAgentProfileUpdate({ teams: [team] }, "agent-1");
		expect(impact.teamIds).toEqual(["team-1"]);
		expect(previewAgentProfileUpdate({ teams: [team] }, "agent-2").teamNames).toEqual(["Team"]);
	});

	it("previews cascade deletion, including responsibility transfer and empty teams", () => {
		const impact = previewAgentProfileDelete(
			{
				agents: [profile("agent-1"), profile("agent-2")],
				teams: [
					team,
					{
						...team,
						id: "solo-team",
						name: "Solo",
						members: [team.members[0]],
					},
				],
			},
			"agent-1",
		);

		expect(impact.teams).toEqual([
			expect.objectContaining({
				teamId: "team-1",
				deletesTeam: false,
				nextLeaderMemberId: "member-2",
				nextLeaderName: "agent-2",
			}),
			expect.objectContaining({ teamId: "solo-team", deletesTeam: true }),
		]);
	});

	it("routes known @handles while ignoring unrelated mentions", () => {
		expect(resolveMentionedMemberIds(team, "请 @Ｒｅｓｅａｒｃｈｅｒ 核查，抄送 @unknown", ["member-1"])).toEqual([
			"member-1",
			"member-2",
		]);
		expect(resolveMentionedMemberIds(team, "没有团队成员提及")).toEqual([]);
	});

	it("keeps team-owned copies out of the reusable agent library", () => {
		expect(
			listLibraryAgentProfiles({
				agents: [profile("library"), profile("copy", { kind: "team", teamId: "team-1" })],
			}).map((agent) => agent.id),
		).toEqual(["library"]);
	});
});
