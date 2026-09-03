import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";

function workspaceDirectoryName(teamId: string): string {
	return Buffer.from(teamId, "utf8").toString("base64url");
}

/** Stable filesystem workspace shared by every Conversation owned by one Team. */
export function resolveTeamWorkspacePath(teamId: string, rootDirectory = getVettaHomePath()): string {
	return join(rootDirectory, "agent-teams", workspaceDirectoryName(teamId), "workspace");
}

export async function ensureTeamWorkspace(teamId: string): Promise<string> {
	const path = resolveTeamWorkspacePath(teamId);
	await mkdir(path, { recursive: true });
	return path;
}
