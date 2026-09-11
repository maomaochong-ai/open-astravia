import { createAgentTeamFixture } from "@vetta/agent-team";
import { describe, expect, it } from "vitest";
import { AGENT_AVATAR_OPTIONS, agentAvatarUrl, teamMemberAvatarUrls } from "./agent-avatar";

describe("Agent avatar options", () => {
	it("exposes all bundled WebP choices and deterministic defaults", () => {
		expect(AGENT_AVATAR_OPTIONS).toHaveLength(9);
		expect(AGENT_AVATAR_OPTIONS.every((avatar) => avatar.endsWith(".webp"))).toBe(true);
		expect(agentAvatarUrl({ id: "a", blueprintId: "master" })).toBe("./agent-team-avatars/master.webp");
		expect(agentAvatarUrl({ id: "b", blueprintId: "researcher" })).toBe("./agent-team-avatars/researcher.webp");
		expect(agentAvatarUrl({ id: "custom", blueprintId: "custom" })).toBe(
			agentAvatarUrl({ id: "custom", blueprintId: "custom" }),
		);
	});

	it("maps retired blueprints onto the role that replaced them", () => {
		expect(agentAvatarUrl({ id: "a", blueprintId: "leader" })).toBe("./agent-team-avatars/master.webp");
		expect(agentAvatarUrl({ id: "b", blueprintId: "builder" })).toBe("./agent-team-avatars/executor.webp");
		expect(agentAvatarUrl({ id: "c", blueprintId: "reviewer" })).toBe("./agent-team-avatars/auditor.webp");
	});

	it("prefers a saved custom avatar and rewrites retired numbered paths", () => {
		expect(agentAvatarUrl({ id: "a", blueprintId: "master", avatar: "./agent-team-avatars/router.webp" })).toBe(
			"./agent-team-avatars/router.webp",
		);
		expect(agentAvatarUrl({ id: "a", blueprintId: "master", avatar: "./agent-team-avatars/avatar-09.webp" })).toBe(
			"./agent-team-avatars/router.webp",
		);
	});

	it("projects Team members to avatar URLs in roster order", () => {
		const document = createAgentTeamFixture();
		const team = document.teams[0];
		if (!team) throw new Error("missing Team fixture");
		const agentsById = new Map(document.agents.map((agent) => [agent.id, agent]));

		expect(teamMemberAvatarUrls(team, agentsById)).toEqual([
			"./agent-team-avatars/master.webp",
			"./agent-team-avatars/architect.webp",
			"./agent-team-avatars/executor.webp",
			"./agent-team-avatars/auditor.webp",
		]);
	});
});
