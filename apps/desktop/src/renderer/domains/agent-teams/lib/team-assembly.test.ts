import type { AgentProfile, TeamDefinition } from "@vetta/agent-team";
import { describe, expect, it } from "vitest";
import {
	assemblyDraftFromTeam,
	buildCreateTeamInput,
	buildUpdateTeamInput,
	canSubmitAssembly,
	emptyAssemblyDraft,
	toggleAssemblyMember,
} from "./team-assembly";

function agent(id: string, mentionHandle = id): AgentProfile {
	return {
		id,
		revision: 1,
		name: id,
		description: "",
		mentionHandle,
		blueprintId: "builder",
		abilities: { skills: [], mcpServers: [], plugins: [] },
		scope: { kind: "library" },
		createdAt: 1,
		updatedAt: 1,
	};
}

const team: TeamDefinition = {
	id: "team",
	revision: 4,
	name: "Existing",
	description: "desc",
	leaderMemberId: "member-b",
	members: [
		{ id: "member-a", handle: "a", binding: { kind: "reference", agentProfileId: "a" } },
		{ id: "member-b", handle: "b", binding: { kind: "reference", agentProfileId: "b" } },
	],
	orchestrationPolicyId: "default",
	contextPolicyId: "default",
	createdAt: 1,
	updatedAt: 1,
};

describe("team assembly draft", () => {
	it("makes the first recruit the leader and hands the crown over when that member leaves", () => {
		const first = toggleAssemblyMember(emptyAssemblyDraft(), "a");
		expect(first.leaderId).toBe("a");

		const second = toggleAssemblyMember(first, "b");
		expect(second.leaderId).toBe("a");

		const withoutLeader = toggleAssemblyMember(second, "a");
		expect(withoutLeader.memberIds).toEqual(["b"]);
		expect(withoutLeader.leaderId).toBe("b");
	});

	it("requires both a name and at least one member before it can be saved", () => {
		expect(canSubmitAssembly({ name: "  ", memberIds: ["a"] })).toBe(false);
		expect(canSubmitAssembly({ name: "Team", memberIds: [] })).toBe(false);
		expect(canSubmitAssembly({ name: "Team", memberIds: ["a"] })).toBe(true);
	});

	it("reads an existing team into a draft with the leader resolved to its Agent", () => {
		expect(assemblyDraftFromTeam(team)).toEqual({
			teamId: "team",
			name: "Existing",
			description: "desc",
			memberIds: ["a", "b"],
			leaderId: "b",
		});
	});
});

describe("team assembly submission", () => {
	const agentsById = new Map([
		["a", agent("a", "shared")],
		["b", agent("b", "shared")],
	]);

	it("creates a team with unique member handles and a single leader", () => {
		const input = buildCreateTeamInput({ name: " Squad ", memberIds: ["a", "b"], leaderId: "b" }, agentsById);
		expect(input.name).toBe("Squad");
		expect(input.members).toEqual([
			{ agentProfileId: "a", handle: "shared", bindingKind: "reference", leader: false },
			{ agentProfileId: "b", handle: "shared-2", bindingKind: "reference", leader: true },
		]);

		const copied = buildCreateTeamInput(
			{ name: "Squad", memberIds: ["a"], leaderId: "a", bindingKinds: { a: "copy" } },
			agentsById,
		);
		expect(copied.members[0]?.bindingKind).toBe("copy");
	});

	it("keeps existing member bindings and only adds the newly recruited Agents", () => {
		const agentsWithNewcomer = new Map(agentsById).set("c", agent("c"));
		const input = buildUpdateTeamInput(
			{ teamId: "team", name: "Existing", memberIds: ["b", "c"], leaderId: "c" },
			team,
			agentsWithNewcomer,
		);
		expect(input.expectedRevision).toBe(4);
		expect(input.description).toBe("desc");
		expect(input.members).toEqual([
			{ kind: "existing", memberId: "member-b", leader: false },
			{ kind: "new", agentProfileId: "c", bindingKind: "reference", leader: true },
		]);
	});

	it("falls back to the first member when the recorded leader was released", () => {
		const input = buildCreateTeamInput({ name: "Squad", memberIds: ["a", "b"], leaderId: "gone" }, agentsById);
		expect(input.members.map((member) => member.leader)).toEqual([true, false]);
	});
});
