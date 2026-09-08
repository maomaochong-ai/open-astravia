import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import type { TeamSessionWorkspaceKind, TeamSessionWorkspaceSelection } from "@vetta/agent-team";
import { readDesktopConfig } from "../config/desktop-config-store.js";
import { sameProjectPath } from "../projects/project-path.js";
import { readAgentTeamStorageIndex, teamSessionWorkspacePath, teamWorkspacePath } from "./agent-team-storage-layout.js";

export interface TeamSessionWorkspace {
	readonly kind: TeamSessionWorkspaceKind;
	readonly id: string;
	readonly cwd: string;
}

export interface TeamWorkspaceDependencies {
	readonly createSessionWorkspace: (
		teamId: string,
		sessionId: string,
	) => Promise<Pick<TeamSessionWorkspace, "id" | "cwd">>;
	readonly listProjectPaths: () => Promise<readonly string[]>;
}

/** Legacy Team-owned workspace retained for existing session and storage migration compatibility. */
export async function resolveTeamWorkspacePath(teamId: string, rootDirectory = getVettaHomePath()): Promise<string> {
	const root = join(rootDirectory, "agent-teams");
	const index = await readAgentTeamStorageIndex(root);
	const directory = index.teams[teamId];
	if (!directory) throw new Error(`Agent Team storage directory not found: ${teamId}`);
	return teamWorkspacePath(root, directory);
}

export async function createTeamSessionWorkspace(
	teamId: string,
	sessionId: string,
	rootDirectory = getVettaHomePath(),
): Promise<Pick<TeamSessionWorkspace, "id" | "cwd">> {
	const root = join(rootDirectory, "agent-teams");
	const index = await readAgentTeamStorageIndex(root);
	const teamDirectory = index.teams[teamId];
	if (!teamDirectory) throw new Error(`Agent Team storage directory not found: ${teamId}`);
	const cwd = teamSessionWorkspacePath(root, teamDirectory, sessionId);
	await mkdir(cwd, { recursive: true });
	return { id: `agent-team:${teamId}:session:${sessionId}`, cwd };
}

const defaultDependencies: TeamWorkspaceDependencies = {
	createSessionWorkspace: createTeamSessionWorkspace,
	listProjectPaths: async () => (await readDesktopConfig()).projects.map((project) => project.path),
};

/** Resolves the immutable workspace captured by a newly created Team session. */
export async function resolveTeamSessionWorkspace(
	teamId: string,
	sessionId: string,
	selection?: TeamSessionWorkspaceSelection,
	dependencies: TeamWorkspaceDependencies = defaultDependencies,
): Promise<TeamSessionWorkspace> {
	if (!selection) {
		return { kind: "session", ...(await dependencies.createSessionWorkspace(teamId, sessionId)) };
	}

	const projectPath = (await dependencies.listProjectPaths()).find((path) => sameProjectPath(path, selection.path));
	if (!projectPath) throw new Error("Selected Team workspace project is unavailable");
	return { kind: "project", id: projectPath, cwd: projectPath };
}
