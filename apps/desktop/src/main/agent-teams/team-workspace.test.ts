import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentTeamStorageKey } from "./agent-team-storage-layout.js";
import { createTeamSessionWorkspace, resolveTeamSessionWorkspace, resolveTeamWorkspacePath } from "./team-workspace.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function createStorageIndex(teamId: string, teamName: string): Promise<string> {
	const root = await mkdtemp(resolve(tmpdir(), "vetta-team-workspace-"));
	temporaryDirectories.push(root);
	const storageRoot = resolve(root, "agent-teams");
	await mkdir(storageRoot, { recursive: true });
	await writeFile(
		resolve(storageRoot, "index.json"),
		JSON.stringify({
			schemaVersion: 1,
			revision: 1,
			layoutVersion: 2,
			teams: { [teamId]: createAgentTeamStorageKey(teamName, teamId) },
			agents: {},
		}),
		"utf8",
	);
	return root;
}

describe("resolveTeamWorkspacePath", () => {
	it("resolves the readable directory recorded in the v2 storage index", async () => {
		const root = await createStorageIndex("team-a", "研发团队");
		const path = await resolveTeamWorkspacePath("team-a", root);
		const relativePath = relative(resolve(root, "agent-teams"), path);

		expect(relativePath.startsWith("..")).toBe(false);
		expect(relativePath).toBe(join("workspaces", createAgentTeamStorageKey("研发团队", "team-a")));
	});

	it("rejects a Team id that is absent from the storage index", async () => {
		const root = await createStorageIndex("team-a", "Team A");
		await expect(resolveTeamWorkspacePath("team-b", root)).rejects.toThrow("storage directory not found");
	});
});

describe("resolveTeamSessionWorkspace", () => {
	const dependencies = {
		createSessionWorkspace: async (teamId: string, sessionId: string) => ({
			id: `agent-team:${teamId}:session:${sessionId}`,
			cwd: `C:/teams/${teamId}/sessions/${sessionId}`,
		}),
		listProjectPaths: async () => ["C:/Projects/Selected"],
	};

	it("allocates a session-owned workspace by default", async () => {
		await expect(resolveTeamSessionWorkspace("team-a", "session-a", undefined, dependencies)).resolves.toEqual({
			kind: "session",
			id: "agent-team:team-a:session:session-a",
			cwd: "C:/teams/team-a/sessions/session-a",
		});
	});

	it("uses the configured project's canonical path when selected", async () => {
		await expect(
			resolveTeamSessionWorkspace(
				"team-a",
				"session-a",
				{ kind: "project", path: "c:/projects/selected/" },
				dependencies,
			),
		).resolves.toEqual({ kind: "project", id: "C:/Projects/Selected", cwd: "C:/Projects/Selected" });
	});

	it("rejects paths that are not active configured projects", async () => {
		await expect(
			resolveTeamSessionWorkspace("team-a", "session-a", { kind: "project", path: "C:/untrusted" }, dependencies),
		).rejects.toThrow("Selected Team workspace project is unavailable");
	});
});

describe("createTeamSessionWorkspace", () => {
	it("creates isolated directories for separate Team sessions", async () => {
		const root = await createStorageIndex("team-a", "Team A");
		const first = await createTeamSessionWorkspace("team-a", "session-a", root);
		const repeated = await createTeamSessionWorkspace("team-a", "session-a", root);
		const second = await createTeamSessionWorkspace("team-a", "session-b", root);

		expect(first.id).toBe("agent-team:team-a:session:session-a");
		expect(second.id).toBe("agent-team:team-a:session:session-b");
		expect(repeated).toEqual(first);
		expect(first.cwd).not.toBe(second.cwd);
		expect(relative(resolve(root, "agent-teams"), first.cwd)).toBe(
			join("session-workspaces", createAgentTeamStorageKey("Team A", "team-a"), "session-a"),
		);
	});
});
