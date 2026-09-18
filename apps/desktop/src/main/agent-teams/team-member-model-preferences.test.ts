import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TeamDefinition } from "@vetta/agent-team";
import { afterEach, describe, expect, it } from "vitest";
import { resolveTeamMemberModel } from "./resolve-team-member-model.js";
import { TeamMemberModelPreferences } from "./team-member-model-preferences.js";

const temporary: string[] = [];
afterEach(async () => {
	for (const root of temporary.splice(0)) await rm(root, { recursive: true, force: true });
});

const team: TeamDefinition = {
	id: "team",
	revision: 1,
	name: "Team",
	description: "",
	leaderMemberId: "member",
	members: [{ id: "member", handle: "worker", binding: { kind: "reference", agentProfileId: "agent-a" } }],
	orchestrationPolicyId: "leader-delegates-v1",
	contextPolicyId: "public-results-v1",
	createdAt: 1,
	updatedAt: 1,
};

describe("Team member model preferences", () => {
	it("persists a user override independently of the team definition and restores inheritance", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-team-model-"));
		temporary.push(root);
		const path = join(root, "member-model-preferences.json");
		const store = new TeamMemberModelPreferences(path);
		expect(await store.list(team)).toEqual({});
		await store.set(team, "member", { modelKey: "provider/model-a" });
		expect(await new TeamMemberModelPreferences(path).list(team)).toEqual({
			member: { agentProfileId: "agent-a", modelKey: "provider/model-a" },
		});
		expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 1 });
		await store.set(team, "member", null);
		expect(await new TeamMemberModelPreferences(path).list(team)).toEqual({});
	});

	it("does not apply a saved model when a plugin replaces the member's agent", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-team-model-"));
		temporary.push(root);
		const store = new TeamMemberModelPreferences(join(root, "models.json"));
		await store.set(team, "member", { modelKey: "provider/model-a" });
		const changed = {
			...team,
			members: [{ ...team.members[0], binding: { kind: "reference" as const, agentProfileId: "agent-b" } }],
		};
		expect(await store.list(changed)).toEqual({});
		expect(
			resolveTeamMemberModel({
				sessionModelKey: "provider/default",
				agentProfileId: "agent-b",
				preference: await store.get("team", "member"),
			}),
		).toEqual({ modelKey: "provider/default", reasoning: undefined });
	});

	it("rejects unknown members and malformed model keys", async () => {
		const root = await mkdtemp(join(tmpdir(), "vetta-team-model-"));
		temporary.push(root);
		const store = new TeamMemberModelPreferences(join(root, "models.json"));
		await expect(store.set(team, "missing", { modelKey: "p/m" })).rejects.toThrow("Team member not found");
		await expect(store.set(team, "member", { modelKey: "" })).rejects.toThrow();
	});
});

describe("resolveTeamMemberModel", () => {
	it("inherits the conversation selection until this member is pinned", () => {
		expect(
			resolveTeamMemberModel({
				modelKey: "p/current",
				reasoning: "high",
				sessionModelKey: "p/old",
				agentProfileId: "agent-a",
			}),
		).toEqual({ modelKey: "p/current", reasoning: "high" });
		expect(
			resolveTeamMemberModel({
				modelKey: "p/current",
				reasoning: "high",
				agentProfileId: "agent-a",
				preference: { agentProfileId: "agent-a", modelKey: "p/fixed" },
			}),
		).toEqual({ modelKey: "p/fixed", reasoning: undefined });
	});
});
