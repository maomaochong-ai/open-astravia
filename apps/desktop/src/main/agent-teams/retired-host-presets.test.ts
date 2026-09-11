import type { AgentTeamDocument } from "@vetta/agent-team";
import { describe, expect, it } from "vitest";
import { dropRetiredHostPresets } from "./retired-host-presets.js";

const MASTER = "be72a2d2-5463-4d20-9ac2-3fd78e9fbb2e";
const ARCHITECT = "934d1f05-1093-4d56-94a1-00642d7eaab6";
const DEV_TEAM = "2f631500-0d58-4458-a595-9e403affa08e";

function profile(id: string, name: string, source?: { kind: "plugin"; pluginId: string }) {
	return {
		id,
		revision: 1,
		name,
		description: "",
		mentionHandle: name.toLocaleLowerCase("en-US"),
		blueprintId: "legacy",
		abilities: { selectionMode: "all" as const, skills: [], mcpServers: [], plugins: [] },
		scope: { kind: "library" as const },
		...(source ? { source } : {}),
		createdAt: 0,
		updatedAt: 0,
	};
}

function document(overrides: Partial<AgentTeamDocument> = {}): AgentTeamDocument {
	return {
		schemaVersion: 1,
		revision: 1,
		agents: [
			profile(MASTER, "Master", { kind: "plugin", pluginId: "preset-agent" }),
			profile(ARCHITECT, "Architect"),
		],
		teams: [],
		...overrides,
	};
}

describe("retired host presets", () => {
	it("drops the host's leftover profiles but keeps the ones a provider claimed", () => {
		const result = dropRetiredHostPresets(document(), 10);

		expect(result?.agents.map((agent) => agent.id)).toEqual([MASTER]);
	});

	it("never touches resources the user created", () => {
		const mine = profile("11111111-2222-3333-4444-555555555555", "Mine");

		const result = dropRetiredHostPresets(document({ agents: [mine] }), 10);

		expect(result).toBeUndefined();
	});

	it("drops the host's leftover teams", () => {
		const team = {
			id: DEV_TEAM,
			revision: 1,
			name: "Dev Team",
			description: "",
			leaderMemberId: "m1",
			members: [{ id: "m1", handle: "master", binding: { kind: "reference" as const, agentProfileId: MASTER } }],
			orchestrationPolicyId: "leader-delegates-v1",
			contextPolicyId: "public-results-v1",
			createdAt: 0,
			updatedAt: 0,
		};

		const result = dropRetiredHostPresets(document({ teams: [team] }), 10);

		expect(result?.teams).toEqual([]);
	});

	it("keeps a user's own team but drops the members it can no longer run", () => {
		const team = {
			id: "99999999-2222-3333-4444-555555555555",
			revision: 1,
			name: "Mine",
			description: "",
			leaderMemberId: "m1",
			members: [
				{ id: "m1", handle: "architect", binding: { kind: "reference" as const, agentProfileId: ARCHITECT } },
				{ id: "m2", handle: "master", binding: { kind: "reference" as const, agentProfileId: MASTER } },
			],
			orchestrationPolicyId: "leader-delegates-v1",
			contextPolicyId: "public-results-v1",
			createdAt: 0,
			updatedAt: 0,
		};

		const result = dropRetiredHostPresets(document({ teams: [team] }), 10);

		expect(result?.teams[0]?.members.map((member) => member.id)).toEqual(["m2"]);
		// 队长被摘掉时顺位提升，团队不会留在没有负责人的状态。
		expect(result?.teams[0]?.leaderMemberId).toBe("m2");
	});
});
