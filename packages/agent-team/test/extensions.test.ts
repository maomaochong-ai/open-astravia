import { describe, expect, it } from "vitest";
import type { TeamDefinition } from "../src/contracts.js";
import {
	AgentTeamExtensionRegistryHost,
	createAgentTeamExtensionRegistry,
	DEFAULT_AGENT_TEAM_EXTENSIONS,
	requireTeamPolicies,
	resolveTeamHandle,
} from "../src/extensions.js";
import { parseAgentTeamDocument } from "../src/validation.js";

const team: TeamDefinition = {
	id: "team",
	revision: 1,
	name: "Team",
	description: "",
	leaderMemberId: "leader",
	members: [
		{ id: "leader", handle: "Lead", binding: { kind: "reference", agentProfileId: "agent-lead" } },
		{ id: "worker", handle: "Worker", binding: { kind: "reference", agentProfileId: "agent-worker" } },
	],
	orchestrationPolicyId: "leader-delegates-v1",
	contextPolicyId: "public-results-v1",
	createdAt: 0,
	updatedAt: 0,
};

describe("Agent Team extension registry", () => {
	it("keeps the built-in policies available when adding an extension", () => {
		const registry = createAgentTeamExtensionRegistry([
			{
				orchestrationPolicies: new Map([
					[
						"broadcast-v1",
						{
							id: "broadcast-v1",
							resolveTargets: ({ team: currentTeam }) => currentTeam.members.map((member) => member.id),
						},
					],
				]),
			},
		]);
		expect(registry.orchestrationPolicies.has("leader-delegates-v1")).toBe(true);
		expect(
			registry.orchestrationPolicies.get("broadcast-v1")?.resolveTargets({ team, requestedMemberIds: [] }),
		).toEqual(["leader", "worker"]);
	});

	it("rejects unknown policy ids before persistence", () => {
		expect(() => requireTeamPolicies("missing", "public-results-v1")).toThrow("Unknown team orchestration policy");
		expect(() => requireTeamPolicies("leader-delegates-v1", "missing")).toThrow("Unknown team context policy");
	});

	it("resolves handles with the same normalization as mentions", () => {
		expect(resolveTeamHandle(team, " @ｗｏｒｋｅｒ ")).toBe("worker");
		expect(DEFAULT_AGENT_TEAM_EXTENSIONS.contextPolicies.has("public-results-v1")).toBe(true);
	});

	it("allows persisted documents to use policies supplied by an extension", () => {
		const registry = createAgentTeamExtensionRegistry([
			{
				orchestrationPolicies: new Map([
					[
						"broadcast-v1",
						{
							id: "broadcast-v1",
							resolveTargets: ({ team: currentTeam }) => currentTeam.members.map((member) => member.id),
						},
					],
				]),
				contextPolicies: new Map([["private-v1", { id: "private-v1", project: () => [] }]]),
			},
		]);
		const document = {
			schemaVersion: 1 as const,
			revision: 1,
			agents: [
				{
					id: "agent-lead",
					revision: 1,
					name: "Lead",
					description: "",
					mentionHandle: "lead",
					blueprintId: "leader",
					abilities: { skills: [], mcpServers: [], plugins: [] },
					scope: { kind: "library" as const },
					createdAt: 0,
					updatedAt: 0,
				},
				{
					id: "agent-worker",
					revision: 1,
					name: "Worker",
					description: "",
					mentionHandle: "worker",
					blueprintId: "builder",
					abilities: { skills: [], mcpServers: [], plugins: [] },
					scope: { kind: "library" as const },
					createdAt: 0,
					updatedAt: 0,
				},
			],
			teams: [{ ...team, orchestrationPolicyId: "broadcast-v1", contextPolicyId: "private-v1" }],
		};
		expect(parseAgentTeamDocument(document, registry).teams[0]?.contextPolicyId).toBe("private-v1");
	});

	it("registers and disposes trusted host policies atomically", () => {
		const host = new AgentTeamExtensionRegistryHost();
		const policy = {
			id: "broadcast-v1",
			resolveTargets: ({ team: currentTeam }: { team: TeamDefinition }) =>
				currentTeam.members.map((member) => member.id),
		};
		const dispose = host.register({ orchestrationPolicies: new Map([[policy.id, policy]]) });
		expect(host.orchestrationPolicies.get(policy.id)).toBe(policy);
		expect(() => host.register({ orchestrationPolicies: new Map([[policy.id, policy]]) })).toThrow("already exists");

		dispose();
		dispose();
		expect(host.orchestrationPolicies.has(policy.id)).toBe(false);
	});
});
