import type { ChangeCode, ChangeEntry, StatusGroups } from "./types";

/**
 * Map one porcelain XY letter to a display code. Copies (`C`) fold into `A` so
 * the letter `C` stays reserved for conflicts, and type changes (`T`) read as
 * modifications.
 */
function mapCode(letter: string): ChangeCode {
	switch (letter) {
		case "A":
		case "C":
			return "A";
		case "D":
			return "D";
		case "R":
			return "R";
		default:
			return "M";
	}
}

/** Both sides absent ("." each) means the record carries no change for us. */
function pushSides(groups: StatusGroups, xy: string, entry: Omit<ChangeEntry, "code">): void {
	const x = xy[0] ?? ".";
	const y = xy[1] ?? ".";
	if (x !== ".") groups.staged.push({ ...entry, code: mapCode(x) });
	if (y !== ".") groups.unstaged.push({ ...entry, code: mapCode(y) });
}

/**
 * Parse `git status --porcelain=v2 -z` output into the three panel lists.
 *
 * Records are NUL-separated; rename entries (`2 …`) carry a second
 * NUL-separated original path. Ignored entries are not requested and therefore
 * absent. The index side (X) and worktree side (Y) are kept apart rather than
 * collapsed, because staging, unstaging and diffing all act on one side only.
 */
export function parseStatus(raw: string): StatusGroups {
	const tokens = raw.split("\0");
	const groups: StatusGroups = { conflict: [], staged: [], unstaged: [] };
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (!token || token.length === 0) continue;
		const kind = token[0];
		if (kind === "1") {
			const parts = token.split(" ");
			const path = parts.slice(8).join(" ");
			if (!path) continue;
			pushSides(groups, parts[1] ?? "..", { path });
		} else if (kind === "2") {
			const parts = token.split(" ");
			const path = parts.slice(9).join(" ");
			// The original path is the next NUL-separated token.
			const origPath = tokens[i + 1] ?? "";
			i += 1;
			if (!path) continue;
			pushSides(groups, parts[1] ?? "..", { path, origPath: origPath || undefined });
		} else if (kind === "u") {
			const parts = token.split(" ");
			const path = parts.slice(10).join(" ");
			if (!path) continue;
			groups.conflict.push({ path, code: "C" });
		} else if (kind === "?") {
			const path = token.slice(2);
			if (!path) continue;
			groups.unstaged.push({ path, code: "U" });
		}
		// kind === "!" (ignored) is not requested; skip anything else.
	}
	return groups;
}

/** Total number of rows across the three lists (a path may count twice). */
export function countChanges(groups: StatusGroups): number {
	return groups.conflict.length + groups.staged.length + groups.unstaged.length;
}

/**
 * One entry per path, for consumers that care about files rather than sides
 * (the turn card's per-path delta and its line stats).
 *
 * Conflicts win; otherwise a non-`M` code wins over `M`, so a path staged as an
 * addition and then edited still reads as "added" rather than "modified".
 */
export function collapseByPath(groups: StatusGroups): ChangeEntry[] {
	const byPath = new Map<string, ChangeEntry>();
	for (const entry of [...groups.staged, ...groups.unstaged]) {
		const existing = byPath.get(entry.path);
		if (!existing) byPath.set(entry.path, entry);
		else if (existing.code === "M" && entry.code !== "M") byPath.set(entry.path, { ...existing, code: entry.code });
	}
	// Conflicts overwrite: an unmerged path must never read as a plain change.
	for (const entry of groups.conflict) byPath.set(entry.path, entry);
	return [...byPath.values()];
}
