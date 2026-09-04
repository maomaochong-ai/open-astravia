import { describe, expect, it } from "vitest";
import { AGENT_AVATAR_OPTIONS, agentAvatarUrl } from "./agent-avatar";

describe("Agent avatar options", () => {
	it("exposes all bundled WebP choices and deterministic defaults", () => {
		expect(AGENT_AVATAR_OPTIONS).toHaveLength(9);
		expect(AGENT_AVATAR_OPTIONS.every((avatar) => avatar.endsWith(".webp"))).toBe(true);
		expect(agentAvatarUrl({ id: "leader", blueprintId: "leader" })).toBe(AGENT_AVATAR_OPTIONS[0]);
		expect(agentAvatarUrl({ id: "researcher", blueprintId: "researcher" })).toBe(AGENT_AVATAR_OPTIONS[1]);
		expect(agentAvatarUrl({ id: "custom", blueprintId: "custom" })).toBe(
			agentAvatarUrl({ id: "custom", blueprintId: "custom" }),
		);
	});

	it("prefers a saved custom avatar", () => {
		expect(
			agentAvatarUrl({ id: "leader", blueprintId: "leader", avatar: "./agent-team-avatars/avatar-09.webp" }),
		).toBe("./agent-team-avatars/avatar-09.webp");
	});
});
