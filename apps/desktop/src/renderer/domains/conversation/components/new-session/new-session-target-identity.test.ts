import { createAgentTeamFixture } from "@vetta/agent-team";
import { describe, expect, it } from "vitest";
import { resolveNewSessionTargetIdentity } from "./new-session-target-identity";
import { agentTargetKey, teamTargetKey } from "./target";

const labels = { memberCount: (count: number) => `${count} members` };

describe("resolveNewSessionTargetIdentity", () => {
	const document = createAgentTeamFixture();
	const team = document.teams[0];
	const agent = document.agents.find((candidate) => candidate.name === "Researcher");
	if (!team || !agent) throw new Error("missing Agent Team fixture");

	it("keeps the greeting when nothing is selected", () => {
		expect(resolveNewSessionTargetIdentity(document, null, labels)).toBeNull();
	});

	it("keeps the greeting until the catalog arrives", () => {
		expect(resolveNewSessionTargetIdentity(undefined, agentTargetKey(agent.id), labels)).toBeNull();
	});

	it("describes a single agent with its own name, description and avatar", () => {
		const identity = resolveNewSessionTargetIdentity(document, agentTargetKey(agent.id), labels);

		expect(identity?.title).toBe(agent.name);
		expect(identity?.subtitle).toBe(agent.description);
		expect(identity?.avatars).toHaveLength(1);
		expect(identity?.avatars[0]?.avatar).toBeTruthy();
	});

	it("describes a team with one avatar per member so the view can fold the overflow", () => {
		const identity = resolveNewSessionTargetIdentity(document, teamTargetKey(team.id), labels);

		expect(identity?.title).toBe(team.name);
		expect(identity?.avatars.length).toBe(team.members.length);
		expect(identity?.avatars.every((avatar) => Boolean(avatar.avatar))).toBe(true);
	});

	it("falls back to the member count when a team has no description", () => {
		const withoutDescription = {
			...document,
			teams: [{ ...team, description: "   " }],
		};

		expect(resolveNewSessionTargetIdentity(withoutDescription, teamTargetKey(team.id), labels)?.subtitle).toBe(
			`${team.members.length} members`,
		);
	});

	it("keeps the greeting when the selected target no longer exists", () => {
		expect(resolveNewSessionTargetIdentity(document, teamTargetKey("removed"), labels)).toBeNull();
		expect(resolveNewSessionTargetIdentity(document, agentTargetKey("removed"), labels)).toBeNull();
	});

	it("changes its replay key with the selected target", () => {
		const first = resolveNewSessionTargetIdentity(document, agentTargetKey(agent.id), labels);
		const second = resolveNewSessionTargetIdentity(document, teamTargetKey(team.id), labels);

		expect(first?.key).not.toBe(second?.key);
	});
});
