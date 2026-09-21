import { describe, expect, it } from "vitest";
import { collapseByPath, countChanges, parseStatus } from "../src/git/parseStatus";

/** Build a NUL-separated porcelain v2 payload from individual records. */
function porcelain(...records: string[]): string {
	return records.join("\0");
}

/** `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>` — 8 fields before the path. */
function ordinary(xy: string, path: string): string {
	return `1 ${xy} N... 100644 100644 100644 aaaaaaa bbbbbbb ${path}`;
}

describe("parseStatus", () => {
	it("splits the index and worktree sides of one path into both sections", () => {
		const groups = parseStatus(porcelain(ordinary("MM", "src/a.ts")));

		expect(groups.staged).toEqual([{ path: "src/a.ts", code: "M" }]);
		expect(groups.unstaged).toEqual([{ path: "src/a.ts", code: "M" }]);
		// The same file legitimately occupies a row in each section.
		expect(countChanges(groups)).toBe(2);
	});

	it("keeps each side's own letter rather than collapsing them", () => {
		const groups = parseStatus(porcelain(ordinary("AD", "src/new.ts")));

		expect(groups.staged).toEqual([{ path: "src/new.ts", code: "A" }]);
		expect(groups.unstaged).toEqual([{ path: "src/new.ts", code: "D" }]);
	});

	it("puts a side with no change in neither section", () => {
		const groups = parseStatus(porcelain(ordinary("M.", "staged-only.ts"), ordinary(".M", "worktree-only.ts")));

		expect(groups.staged.map((e) => e.path)).toEqual(["staged-only.ts"]);
		expect(groups.unstaged.map((e) => e.path)).toEqual(["worktree-only.ts"]);
	});

	it("reads renames with their original path", () => {
		const record = "2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 new/name.ts";
		const groups = parseStatus(porcelain(record, "old/name.ts"));

		expect(groups.staged).toEqual([{ path: "new/name.ts", origPath: "old/name.ts", code: "R" }]);
		expect(groups.unstaged).toEqual([]);
	});

	it("routes unmerged paths to the conflict section, not to modified", () => {
		const record = "u UU N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc src/conflict.ts";
		const groups = parseStatus(porcelain(record));

		expect(groups.conflict).toEqual([{ path: "src/conflict.ts", code: "C" }]);
		expect(groups.staged).toEqual([]);
		expect(groups.unstaged).toEqual([]);
	});

	it("treats untracked files as unstaged additions", () => {
		const groups = parseStatus(porcelain("? docs/new.md"));

		expect(groups.unstaged).toEqual([{ path: "docs/new.md", code: "U" }]);
	});

	it("folds copies into additions so the letter C stays reserved for conflicts", () => {
		const groups = parseStatus(porcelain(ordinary("C.", "src/copy.ts")));

		expect(groups.staged).toEqual([{ path: "src/copy.ts", code: "A" }]);
	});

	it("ignores ignored-file records", () => {
		const groups = parseStatus(porcelain("! dist/bundle.js"));

		expect(countChanges(groups)).toBe(0);
	});
});

describe("collapseByPath", () => {
	it("emits one entry per path, preferring the more specific code over M", () => {
		const groups = parseStatus(porcelain(ordinary("AM", "src/new.ts")));

		expect(collapseByPath(groups)).toEqual([{ path: "src/new.ts", code: "A" }]);
	});

	it("lets a conflict override any plain change on the same path", () => {
		const groups = parseStatus(
			porcelain(ordinary("M.", "src/x.ts"), "u UU N... 100644 100644 100644 100644 aaaaaaa bbbbbbb ccccccc src/x.ts"),
		);

		expect(collapseByPath(groups)).toEqual([{ path: "src/x.ts", code: "C" }]);
	});
});
