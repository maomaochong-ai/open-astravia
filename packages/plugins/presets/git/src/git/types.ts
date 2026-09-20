/**
 * Single-letter status shown in the tree. One side of a porcelain XY pair, plus
 * `U` for untracked and `C` for an unmerged (conflicting) path.
 *
 * Note `C` is NOT git's "copied" letter — copies are folded into `A`, so this
 * vocabulary stays unambiguous for the conflict section.
 */
export type ChangeCode = "M" | "A" | "D" | "R" | "U" | "C";

export interface ChangeEntry {
	/** Repo-root-relative path (forward slashes). For renames this is the new path. */
	path: string;
	/** Original path for renames. */
	origPath?: string;
	code: ChangeCode;
}

/**
 * Which list a change belongs to. A path with both index and worktree changes
 * (porcelain `MM`) appears in `staged` AND `unstaged` with its respective code,
 * exactly as git models it — the two sides diff against different things.
 */
export type ChangeSection = "conflict" | "staged" | "unstaged";

/** `git status` split into the three lists the panel renders. */
export interface StatusGroups {
	conflict: ChangeEntry[];
	staged: ChangeEntry[];
	unstaged: ChangeEntry[];
}

/** A file identified by both its section and path — sections may repeat a path. */
export interface ChangeRef {
	section: ChangeSection;
	path: string;
}

/** A computed "this turn's changes" result for the turn card (persisted per cwd). */
export interface TurnChangeDelta {
	entries: ChangeEntry[];
	additions: number;
	deletions: number;
}

/** Which ref namespace the graph draws: local branches or remote-tracking branches. */
export type GraphScope = "local" | "remote";

/** A selectable branch in the top switcher (`null` branch = all branches in scope). */
export interface BranchRef {
	/** Short name, e.g. "main" (local) or "origin/main" (remote). */
	name: string;
	/** The commit the ref points at. */
	head: string;
}

/** Current top-switcher selection: a scope plus a specific branch, or all of the scope. */
export interface GraphSelection {
	scope: GraphScope;
	/** A specific ref name, or `null` for all branches in the scope. */
	branch: string | null;
}

/** One commit parsed from `git log`, the unit the graph renders. */
export interface CommitNode {
	hash: string;
	/** Parent hashes ([] for the root commit, 1 normal, 2+ a merge). */
	parents: string[];
	/** Ref names decorating this commit, e.g. ["HEAD", "main", "origin/main", "tag: v1"]. */
	refs: string[];
	authorName: string;
	authorEmail: string;
	/** Author date, unix seconds. */
	timestamp: number;
	subject: string;
	body: string;
}
