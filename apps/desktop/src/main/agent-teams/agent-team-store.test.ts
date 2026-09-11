import { type AgentTeamDocument, createAgentTeamFixture, INITIAL_AGENT_PROFILES } from "@vetta/agent-team";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTeamConfigRepository } from "./agent-team-config-repository.js";
import { AgentTeamStore, PROVIDED_RESOURCE_DELETE_ERROR } from "./agent-team-store.js";
import { registerPresetPluginBlueprints } from "./preset-plugin-blueprints.testing.js";

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

class MemoryRepository implements AgentTeamConfigRepository {
	document: AgentTeamDocument = createAgentTeamFixture();
	writes = 0;
	failNextWrite = false;

	async read(): Promise<AgentTeamDocument> {
		return structuredClone(this.document);
	}

	async write(document: AgentTeamDocument): Promise<void> {
		this.writes += 1;
		if (this.failNextWrite) {
			this.failNextWrite = false;
			throw new Error("disk full");
		}
		await Promise.resolve();
		this.document = structuredClone(document);
	}
}

function createIdSequence(): () => string {
	let value = 0;
	return () => `id-${++value}`;
}

function agentInput(name: string) {
	return {
		name,
		mentionHandle: name.toLocaleLowerCase("en-US"),
		blueprintId: "builder",
		abilities: { skills: [], mcpServers: [], plugins: [] },
	};
}

describe("AgentTeamStore transaction boundary", () => {
	// master / developer / researcher 的人设住在「预设智能体」插件里，装机档案要靠它解析。
	beforeEach(() => registerPresetPluginBlueprints());

	it("serializes concurrent mutations without losing either profile", async () => {
		const repository = new MemoryRepository();
		const store = new AgentTeamStore({ repository, createId: createIdSequence(), now: () => 10 });

		await Promise.all([store.createAgent(agentInput("Alpha")), store.createAgent(agentInput("Beta"))]);

		expect(repository.document.revision).toBe(3);
		expect(repository.document.agents.slice(-2).map((agent) => agent.name)).toEqual(["Alpha", "Beta"]);
		expect(repository.writes).toBe(2);
	});

	it("does not publish a failed write and allows the next mutation to recover", async () => {
		const repository = new MemoryRepository();
		const store = new AgentTeamStore({ repository, createId: createIdSequence(), now: () => 10 });
		repository.failNextWrite = true;

		await expect(store.createAgent(agentInput("Failed"))).rejects.toThrow("disk full");
		await expect(store.createAgent(agentInput("Recovered"))).resolves.toMatchObject({ name: "Recovered" });

		const document = await store.read();
		expect(document.revision).toBe(2);
		expect(document.agents.at(-1)?.name).toBe("Recovered");
	});

	it("gives newly created agents all abilities unless a custom selection is provided", async () => {
		const repository = new MemoryRepository();
		const store = new AgentTeamStore({ repository, createId: createIdSequence(), now: () => 10 });

		const created = await store.createAgent({
			name: "Default",
			mentionHandle: "default",
			blueprintId: "builder",
		});

		expect(created.abilities.selectionMode).toBe("all");
	});

	it("allows customizing an initially supplied profile like any other profile", async () => {
		const repository = new MemoryRepository();
		const store = new AgentTeamStore({ repository, createId: createIdSequence(), now: () => 10 });
		const source = INITIAL_AGENT_PROFILES[0];
		if (!source) throw new Error("Expected an initial Agent profile");

		const updated = await store.updateAgent(source.id, {
			expectedRevision: source.revision,
			name: "Custom leader",
			description: "A customized role",
			mentionHandle: source.mentionHandle,
			abilities: source.abilities,
		});

		expect(updated).toMatchObject({
			id: source.id,
			name: "Custom leader",
			description: "A customized role",
		});
	});

	it("clears the system prompt override when the editor is left empty", async () => {
		const repository = new MemoryRepository();
		const store = new AgentTeamStore({ repository, createId: createIdSequence(), now: () => 10 });
		const created = await store.createAgent(agentInput("Prompted"));

		const overridden = await store.updateAgent(created.id, {
			expectedRevision: created.revision,
			name: created.name,
			description: created.description,
			systemPrompt: "  Speak plainly.  ",
			mentionHandle: created.mentionHandle,
			abilities: created.abilities,
		});
		expect(overridden.systemPrompt).toBe("Speak plainly.");

		// 留空即回到 blueprint 默认；存成空串会让下游的 `?? blueprint` 兜底失效。
		const cleared = await store.updateAgent(overridden.id, {
			expectedRevision: overridden.revision,
			name: overridden.name,
			description: overridden.description,
			systemPrompt: "   ",
			mentionHandle: overridden.mentionHandle,
			abilities: overridden.abilities,
		});
		expect(cleared.systemPrompt).toBeUndefined();
	});

	it("keeps a member assignment across unrelated team edits and clears it on demand", async () => {
		const repository = new MemoryRepository();
		const store = new AgentTeamStore({ repository, createId: createIdSequence(), now: () => 10 });
		const document = await store.read();
		const team = document.teams[0];
		if (!team) throw new Error("Expected an initial team");
		const memberId = team.members[0]?.id;
		if (!memberId) throw new Error("Expected a team member");

		const assigned = await store.updateTeam(team.id, {
			expectedRevision: team.revision,
			name: team.name,
			description: team.description,
			members: team.members.map((member) => ({
				kind: "existing" as const,
				memberId: member.id,
				leader: member.id === team.leaderMemberId,
				...(member.id === memberId
					? { assignment: { responsibility: "  Owns the release checklist.  ", instructions: "   " } }
					: {}),
			})),
		});
		// 空白折算成缺省，非空去掉首尾空格。
		expect(assigned.members[0]?.assignment).toEqual({ responsibility: "Owns the release checklist." });

		const renamed = await store.updateTeam(assigned.id, {
			expectedRevision: assigned.revision,
			name: "Renamed team",
			description: assigned.description,
			members: assigned.members.map((member) => ({
				kind: "existing" as const,
				memberId: member.id,
				leader: member.id === assigned.leaderMemberId,
			})),
		});
		// 输入不带 assignment 表示「本次没碰任务书」，不能被静默清空。
		expect(renamed.members[0]?.assignment).toEqual({ responsibility: "Owns the release checklist." });

		const cleared = await store.updateTeam(renamed.id, {
			expectedRevision: renamed.revision,
			name: renamed.name,
			description: renamed.description,
			members: renamed.members.map((member) => ({
				kind: "existing" as const,
				memberId: member.id,
				leader: member.id === renamed.leaderMemberId,
				assignment: { responsibility: "", instructions: "" },
			})),
		});
		expect(cleared.members[0]?.assignment).toBeUndefined();
	});

	it("allows deleting an initially supplied profile like any other profile", async () => {
		const repository = new MemoryRepository();
		const store = new AgentTeamStore({ repository, createId: createIdSequence(), now: () => 10 });
		const source = INITIAL_AGENT_PROFILES[0];
		if (!source) throw new Error("Expected an initial Agent profile");

		const impact = await store.previewAgentDelete(source.id);
		await expect(
			store.deleteAgent(source.id, {
				expectedRevision: source.revision,
				expectedTeamIds: impact.teams.map((team) => team.teamId),
				expectedTeamRevisions: Object.fromEntries(impact.teams.map((team) => [team.teamId, team.teamRevision])),
			}),
		).resolves.toBeUndefined();
		expect((await store.read()).agents.some((agent) => agent.id === source.id)).toBe(false);
	});

	it("refuses to delete an agent or a team that a provider owns", async () => {
		const repository = new MemoryRepository();
		const document = repository.document;
		const agent = document.agents[0]!;
		const team = document.teams[0]!;
		// 回填会给提供方铺下的资源盖戳；盖过戳的删不得，它下次启动本来也会被补回来。
		repository.document = {
			...document,
			agents: document.agents.map((candidate) =>
				candidate.id === agent.id
					? { ...candidate, source: { kind: "plugin" as const, pluginId: "preset-agent" } }
					: candidate,
			),
			teams: document.teams.map((candidate) =>
				candidate.id === team.id
					? { ...candidate, source: { kind: "plugin" as const, pluginId: "preset-agent" } }
					: candidate,
			),
		};
		const store = new AgentTeamStore({ repository, createId: createIdSequence(), now: () => 10 });

		const impact = await store.previewAgentDelete(agent.id);
		await expect(
			store.deleteAgent(agent.id, {
				expectedRevision: agent.revision,
				expectedTeamIds: impact.teams.map((entry) => entry.teamId),
				expectedTeamRevisions: Object.fromEntries(impact.teams.map((entry) => [entry.teamId, entry.teamRevision])),
			}),
		).rejects.toThrow(PROVIDED_RESOURCE_DELETE_ERROR);
		await expect(store.deleteTeam(team.id, { expectedRevision: team.revision })).rejects.toThrow(
			PROVIDED_RESOURCE_DELETE_ERROR,
		);

		const reloaded = await store.read();
		expect(reloaded.agents.some((candidate) => candidate.id === agent.id)).toBe(true);
		expect(reloaded.teams.some((candidate) => candidate.id === team.id)).toBe(true);
	});

	it("deletes an unreferenced agent and cascades reviewed team references", async () => {
		const repository = new MemoryRepository();
		const store = new AgentTeamStore({ repository, createId: createIdSequence(), now: () => 10 });
		const removable = await store.createAgent(agentInput("Removable"));

		await store.deleteAgent(removable.id, { expectedRevision: removable.revision });
		expect((await store.read()).agents).toHaveLength(INITIAL_AGENT_PROFILES.length);

		const referenced = await store.createAgent(agentInput("Referenced"));
		const referencedTeam = await store.createTeam({
			name: "Team",
			members: [
				{
					agentProfileId: referenced.id,
					handle: referenced.mentionHandle,
					bindingKind: "reference",
					leader: true,
				},
			],
		});
		await expect(store.deleteAgent(referenced.id, { expectedRevision: referenced.revision })).rejects.toThrow(
			"review affected teams",
		);
		const staleImpact = await store.previewAgentDelete(referenced.id);
		await store.updateTeam(referencedTeam.id, {
			expectedRevision: referencedTeam.revision,
			name: referencedTeam.name,
			description: referencedTeam.description,
			members: referencedTeam.members.map((member) => ({
				kind: "existing" as const,
				memberId: member.id,
				leader: member.id === referencedTeam.leaderMemberId,
			})),
		});
		await expect(
			store.deleteAgent(referenced.id, {
				expectedRevision: referenced.revision,
				expectedTeamIds: staleImpact.teams.map((team) => team.teamId),
				expectedTeamRevisions: Object.fromEntries(
					staleImpact.teams.map((team) => [team.teamId, team.teamRevision]),
				),
			}),
		).rejects.toThrow("review affected teams");
		const impact = await store.previewAgentDelete(referenced.id);
		await store.deleteAgent(referenced.id, {
			expectedRevision: referenced.revision,
			expectedTeamIds: impact.teams.map((team) => team.teamId),
			expectedTeamRevisions: Object.fromEntries(impact.teams.map((team) => [team.teamId, team.teamRevision])),
		});
		expect((await store.read()).teams.some((team) => team.name === "Team")).toBe(false);
	});

	it("updates a team roster atomically and transfers responsibility", async () => {
		const repository = new MemoryRepository();
		const store = new AgentTeamStore({ repository, createId: createIdSequence(), now: () => 10 });
		const first = await store.createAgent(agentInput("First"));
		const second = await store.createAgent(agentInput("Second"));
		const team = await store.createTeam({
			name: "Team",
			members: [
				{
					agentProfileId: first.id,
					handle: first.mentionHandle,
					bindingKind: "reference",
					leader: true,
				},
			],
		});

		const updated = await store.updateTeam(team.id, {
			expectedRevision: team.revision,
			name: team.name,
			description: team.description,
			members: [
				{
					kind: "new",
					agentProfileId: second.id,
					bindingKind: "reference",
					leader: true,
				},
			],
		});

		expect(updated.members).toHaveLength(1);
		expect(updated.members[0]?.binding.agentProfileId).toBe(second.id);
		expect(updated.leaderMemberId).toBe(updated.members[0]?.id);
	});

	it("turns a copied initial profile into an independently editable profile", async () => {
		const repository = new MemoryRepository();
		const store = new AgentTeamStore({ repository, createId: createIdSequence(), now: () => 10 });
		const source = INITIAL_AGENT_PROFILES[0];
		if (!source) throw new Error("Expected an initial Agent profile");

		const team = await store.createTeam({
			name: "Copy team",
			members: [
				{
					agentProfileId: source.id,
					handle: "copy-leader",
					bindingKind: "copy",
					leader: true,
				},
			],
		});
		const copiedMember = team.members[0];
		if (!copiedMember) throw new Error("Expected a copied team member");
		const copiedId = copiedMember.binding.agentProfileId;
		const copied = (await store.read()).agents.find((agent) => agent.id === copiedId);

		expect(copied).toMatchObject({ scope: { kind: "team", teamId: team.id } });
	});
});
