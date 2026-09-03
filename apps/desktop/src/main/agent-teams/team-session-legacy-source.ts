import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { getVettaHomePath } from "@vetta/action-rpc";
import { parseTeamSessionDocument, type TeamSessionDocument } from "@vetta/agent-team";

export const LEGACY_TEAM_SESSION_ROOT = join(getVettaHomePath(), "desktop-app", "agent-teams", "sessions");

export interface LegacyTeamSessionSource {
	list?(): Promise<readonly TeamSessionDocument[]>;
}

/** Worker-safe legacy discovery: filesystem and schema parsing only, with no Electron or main-process logger. */
export async function listLegacyTeamSessionDocuments(
	rootDirectory = LEGACY_TEAM_SESSION_ROOT,
	onInvalid?: (id: string, error: unknown) => void,
): Promise<readonly TeamSessionDocument[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(rootDirectory, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const candidates = entries
		.filter((entry) => entry.isFile() && extname(entry.name) === ".json")
		.map((entry) => ({ id: basename(entry.name, ".json"), path: join(rootDirectory, entry.name) }));
	const results = await Promise.allSettled(
		candidates.map(async (candidate) => parseTeamSessionDocument(JSON.parse(await readFile(candidate.path, "utf8")))),
	);
	return results.flatMap((result, index) => {
		if (result.status === "fulfilled") return [result.value];
		onInvalid?.(candidates[index]?.id ?? "unknown", result.reason);
		return [];
	});
}
