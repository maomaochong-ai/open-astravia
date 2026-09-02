import { type AgentTeamDocument, BUILTIN_AGENT_PRESETS, createInitialAgentTeamDocument } from "@vetta/agent-team";
import { describe, expect, it, vi } from "vitest";
import type { AgentTeamConfigRepository } from "./agent-team-config-repository.js";
import { AgentTeamStore } from "./agent-team-store.js";

vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

class MemoryRepository implements AgentTeamConfigRepository {
	document: AgentTeamDocument = createInitialAgentTeamDocument();
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

	it("deletes an unreferenced agent and cascades reviewed team references", async () => {
		const repository = new MemoryRepository();
		const store = new AgentTeamStore({ repository, createId: createIdSequence(), now: () => 10 });
		const removable = await store.createAgent(agentInput("Removable"));

		await store.deleteAgent(removable.id, { expectedRevision: removable.revision });
		expect((await store.read()).agents).toHaveLength(BUILTIN_AGENT_PRESETS.length);

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

	it("turns a copied built-in preset into an independently editable profile", async () => {
		const repository = new MemoryRepository();
		const store = new AgentTeamStore({ repository, createId: createIdSequence(), now: () => 10 });
		const source = BUILTIN_AGENT_PRESETS[0];
		if (!source) throw new Error("Expected a built-in Agent preset");

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
		expect(copied?.presetId).toBeUndefined();
	});
});
