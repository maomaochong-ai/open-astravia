import type { GitStatusEntry } from "@pierre/trees";
import type { ChangeCode, ChangeEntry } from "./types";

/** Map our collapsed status code to the tree library's git-status vocabulary. */
const CODE_TO_STATUS: Record<ChangeCode, GitStatusEntry["status"]> = {
	M: "modified",
	A: "added",
	D: "deleted",
	R: "renamed",
	U: "untracked",
	// The tree library has no conflict status; modified is the closest marker and
	// the conflict section already carries the meaning.
	C: "modified",
};

/** Flatten change entries into the path list + git-status entries the tree consumes. */
export function buildGitStatus(entries: readonly ChangeEntry[]): {
	paths: string[];
	gitStatus: GitStatusEntry[];
} {
	const paths: string[] = [];
	const gitStatus: GitStatusEntry[] = [];
	for (const entry of entries) {
		paths.push(entry.path);
		gitStatus.push({ path: entry.path, status: CODE_TO_STATUS[entry.code] });
	}
	return { paths, gitStatus };
}

/** Find the change entry for a selected tree path (null for directories / stale paths). */
export function findEntry(entries: readonly ChangeEntry[], path: string): ChangeEntry | null {
	return entries.find((entry) => entry.path === path) ?? null;
}
