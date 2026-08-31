import { describe, expect, it } from "vitest";
import type { DesktopSessionSearchResult } from "./session-search.js";
import { mergeSessionSearchResults } from "./session-search-results.js";

function result(path: string, modifiedAt: number): DesktopSessionSearchResult {
	return {
		session: {
			id: path,
			path,
			modifiedAt,
			cwd: "/work",
			firstMessage: "",
			access: { readHistory: true, resume: true, rename: true, delete: true },
		},
		sourceKind: "project",
		sourceCwd: "/work",
		match: { field: "title", snippet: path },
	};
}

describe("incremental search result ordering", () => {
	it("retains the newest matches across batches with stable ties, without mutating inputs", () => {
		const previous = [result("old", 1), result("b", 2)];
		const next = mergeSessionSearchResults(previous, [result("a", 2), result("new", 3)], 3);
		expect(next.map((entry) => entry.session.path)).toEqual(["new", "a", "b"]);
		expect(previous.map((entry) => entry.session.path)).toEqual(["old", "b"]);
		expect(mergeSessionSearchResults(next, [result("b", 4)], 3).map((entry) => entry.session.path)).toEqual([
			"b",
			"new",
			"a",
		]);
	});
	it("defaults to 100 results and does not let invalid times destabilize ordering", () => {
		const hits = Array.from({ length: 150 }, (_, i) => result(`p-${i}`, i + 1));
		const next = mergeSessionSearchResults([], [...hits, result("unknown", NaN)]);
		expect(next).toHaveLength(100);
		expect(next[0].session.modifiedAt).toBe(150);
		expect(next.at(-1)?.session.modifiedAt).toBe(51);
	});
});
