import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codingAgentSessionShardPath } from "@vetta/coding-agent/bootstrap";
import { afterEach, describe, expect, it } from "vitest";
import {
	createAgentTeamStorageKey,
	memberAssignmentFileName,
	migrateAgentTeamStorage,
	readAgentTeamStorageIndex,
} from "./agent-team-storage-layout.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("Agent Team storage layout", () => {
	it("creates readable, stable and path-safe directory keys", () => {
		expect(createAgentTeamStorageKey("深度 研究 / Review", "team-a")).toMatch(/^深度-研究-review--[a-f0-9]{10}$/u);
		expect(createAgentTeamStorageKey("CON", "..")).toMatch(/^con--[a-f0-9]{10}$/u);
		expect(createAgentTeamStorageKey("Same name", "team-a")).not.toBe(
			createAgentTeamStorageKey("Same name", "team-b"),
		);
	});

	it("moves legacy definitions, workspaces and session references into layout v2", async () => {
		const vettaHome = await mkdtemp(join(tmpdir(), "vetta-agent-team-migration-"));
		temporaryDirectories.push(vettaHome);
		const root = join(vettaHome, "agent-teams");
		const teamId = "builtin:team:dev";
		const migratedTeamId = "2f631500-0d58-4458-a595-9e403affa08e";
		const teamName = "研发团队";
		const agentId = "builtin:agent:architect";
		const migratedAgentId = "934d1f05-1093-4d56-94a1-00642d7eaab6";
		const agentName = "Architect";
		const memberId = "builtin:member:dev:master";
		const migratedMemberId = "5331fb94-0f3a-45c5-9ba1-32048a5067d3";
		const memberHandle = "master";
		const legacyTeamRoot = join(root, encodeURIComponent(teamId).replace(/%/gu, "_"));
		const legacyAgentRoot = join(root, "agents", encodeURIComponent(agentId).replace(/%/gu, "_"));
		const legacyWorkspaceRoot = join(root, Buffer.from(teamId, "utf8").toString("base64url"));
		const oldCwd = join(legacyWorkspaceRoot, "workspace");

		await mkdir(join(legacyTeamRoot, "members"), { recursive: true });
		await mkdir(legacyAgentRoot, { recursive: true });
		await mkdir(oldCwd, { recursive: true });
		await writeFile(join(root, "index.json"), JSON.stringify({ schemaVersion: 1, revision: 4 }), "utf8");
		await writeFile(join(root, ".initialized"), "1\n", "utf8");
		await writeFile(
			join(legacyTeamRoot, "team.json"),
			JSON.stringify({
				id: teamId,
				name: teamName,
				leaderMemberId: memberId,
				members: [{ id: memberId, handle: memberHandle, binding: { agentProfileId: agentId, kind: "reference" } }],
			}),
			"utf8",
		);
		await writeFile(join(legacyTeamRoot, "description.md"), "Team description", "utf8");
		await writeFile(
			join(legacyTeamRoot, "members", `${encodeURIComponent(memberId).replace(/%/gu, "_")}.md`),
			"Member brief",
			"utf8",
		);
		await writeFile(
			join(legacyAgentRoot, "agent.json"),
			JSON.stringify({ id: agentId, name: agentName, presetId: "architect" }),
			"utf8",
		);
		await writeFile(join(legacyAgentRoot, "description.md"), "Agent description", "utf8");
		await writeFile(join(oldCwd, "artifact.txt"), "workspace data", "utf8");

		const agentDir = join(vettaHome, "agent");
		const oldShard = codingAgentSessionShardPath(oldCwd, agentDir);
		const oldSessionPath = join(oldShard, "session.conversation.jsonl");
		await mkdir(oldShard, { recursive: true });
		await writeFile(
			oldSessionPath,
			`${[
				JSON.stringify({ recordType: "conversation.header", cwd: oldCwd }),
				JSON.stringify({
					recordType: "conversation.document.operation",
					command: {
						data: {
							session: {
								teamId,
								workspaceId: `agent-team:${teamId}`,
								requestId: `request:${teamId}:${memberId}`,
								leaderMemberId: memberId,
								memberHandles: { [memberId]: memberHandle },
								cwd: oldCwd,
								coordinationRuntime: { sessionPath: oldSessionPath },
							},
						},
					},
				}),
				JSON.stringify({ recordType: "conversation.event", event: { message: { content: oldCwd } } }),
				JSON.stringify({ recordType: "conversation.event", event: { message: { content: teamId } } }),
			].join("\n")}\n`,
			"utf8",
		);
		await writeFile(
			join(vettaHome, "conversation-ownership.v1.json"),
			JSON.stringify({ records: [{ sessionPath: oldSessionPath }] }),
			"utf8",
		);

		const result = await migrateAgentTeamStorage(root);
		const teamDirectory = createAgentTeamStorageKey(teamName, migratedTeamId);
		const agentDirectory = createAgentTeamStorageKey(agentName, migratedAgentId);
		const newCwd = join(root, "workspaces", teamDirectory);
		const newShard = codingAgentSessionShardPath(newCwd, agentDir);
		const newSessionPath = join(newShard, "session.conversation.jsonl");

		expect(result.migrated).toBe(true);
		expect(existsSync(legacyTeamRoot)).toBe(false);
		expect(existsSync(legacyWorkspaceRoot)).toBe(false);
		expect(existsSync(oldShard)).toBe(false);
		const migratedTeam = await readFile(join(root, "teams", teamDirectory, "team.json"), "utf8");
		expect(migratedTeam).toContain(migratedTeamId);
		expect(migratedTeam).toContain(migratedAgentId);
		expect(migratedTeam).not.toContain("builtin:");
		const migratedAgent = await readFile(join(root, "agents", agentDirectory, "agent.json"), "utf8");
		expect(migratedAgent).toContain(migratedAgentId);
		expect(migratedAgent).not.toContain("presetId");
		expect(
			await readFile(
				join(root, "teams", teamDirectory, "members", memberAssignmentFileName(migratedMemberId, memberHandle)),
				"utf8",
			),
		).toBe("Member brief");
		expect(await readFile(join(newCwd, "artifact.txt"), "utf8")).toBe("workspace data");

		const lines = (await readFile(newSessionPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(lines[0]).toMatchObject({ cwd: newCwd });
		expect(lines[1]).toMatchObject({
			command: {
				data: {
					session: {
						teamId: migratedTeamId,
						workspaceId: `agent-team:${migratedTeamId}`,
						requestId: `request:${migratedTeamId}:${migratedMemberId}`,
						leaderMemberId: migratedMemberId,
						memberHandles: { [migratedMemberId]: memberHandle },
						cwd: newCwd,
						coordinationRuntime: { sessionPath: newSessionPath },
					},
				},
			},
		});
		// Free-form historical message text is not rewritten merely because it mentions the old path.
		expect(lines[2]).toMatchObject({ event: { message: { content: oldCwd } } });
		// An exact retired id in message content is still user text, not a structured identity reference.
		expect(lines[3]).toMatchObject({ event: { message: { content: teamId } } });
		expect(JSON.parse(await readFile(join(vettaHome, "conversation-ownership.v1.json"), "utf8"))).toEqual({
			records: [{ sessionPath: newSessionPath }],
		});

		const index = await readAgentTeamStorageIndex(root);
		expect(index).toMatchObject({
			layoutVersion: 2,
			revision: 4,
			teams: { [migratedTeamId]: teamDirectory },
			agents: { [migratedAgentId]: agentDirectory },
		});
		expect(await readdir(root)).not.toContain(".storage-migration-v2.json");
		await expect(migrateAgentTeamStorage(root)).resolves.toMatchObject({ migrated: false });
	});

	it("keeps a deleted Team workspace as an explicit orphan", async () => {
		const vettaHome = await mkdtemp(join(tmpdir(), "vetta-agent-team-orphan-"));
		temporaryDirectories.push(vettaHome);
		const root = join(vettaHome, "agent-teams");
		const teamId = "builtin:team:vetta";
		const legacyRoot = join(root, encodeURIComponent(teamId));
		await mkdir(join(legacyRoot, "workspace"), { recursive: true });
		await writeFile(join(root, "index.json"), JSON.stringify({ schemaVersion: 1, revision: 1 }), "utf8");
		await writeFile(join(legacyRoot, "workspace", "kept.txt"), "keep", "utf8");

		await migrateAgentTeamStorage(root);
		const migratedTeamId = "7d8383c0-c0da-47cc-8952-bb28e6d3af54";

		const orphanRoot = join(
			root,
			".orphaned",
			"workspaces",
			`${createAgentTeamStorageKey("Vetta Team", migratedTeamId)}--percent`,
		);
		expect(await readFile(join(orphanRoot, "kept.txt"), "utf8")).toBe("keep");
		expect(existsSync(legacyRoot)).toBe(false);
	});
});
