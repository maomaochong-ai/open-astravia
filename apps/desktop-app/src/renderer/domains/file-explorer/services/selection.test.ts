import { describe, expect, it } from "vitest";
import {
	applyFileExplorerSelection,
	applyMarqueeSelection,
	buildFileTreeFlatPaths,
	EMPTY_FILE_EXPLORER_SELECTION,
	moveFileExplorerFocus,
	selectAllVisible,
} from "./selection";

describe("buildFileTreeFlatPaths", () => {
	it("walks expanded directories only", () => {
		const cache = new Map([
			[
				"/root",
				[
					{ path: "/root/a", isDirectory: true },
					{ path: "/root/b.txt", isDirectory: false },
				],
			],
			["/root/a", [{ path: "/root/a/c.txt", isDirectory: false }]],
		]);
		expect(buildFileTreeFlatPaths("/root", cache, new Set())).toEqual(["/root/a", "/root/b.txt"]);
		expect(buildFileTreeFlatPaths("/root", cache, new Set(["/root/a"]))).toEqual([
			"/root/a",
			"/root/a/c.txt",
			"/root/b.txt",
		]);
	});
});

describe("applyFileExplorerSelection", () => {
	const flat = ["/a", "/b", "/c", "/d"];

	it("replaces selection on activate", () => {
		const next = applyFileExplorerSelection(
			{ paths: ["/a", "/b"], anchorPath: "/a", focusedPath: "/b" },
			flat,
			"/c",
			{ toggle: false, range: false, activate: true },
		);
		expect(next).toEqual({ paths: ["/c"], anchorPath: "/c", focusedPath: "/c" });
	});

	it("toggles membership with ctrl/meta gesture", () => {
		const added = applyFileExplorerSelection(EMPTY_FILE_EXPLORER_SELECTION, flat, "/b", {
			toggle: true,
			range: false,
			activate: false,
		});
		expect(added.paths).toEqual(["/b"]);
		const removed = applyFileExplorerSelection(added, flat, "/b", {
			toggle: true,
			range: false,
			activate: false,
		});
		expect(removed.paths).toEqual([]);
	});

	it("selects a range from the anchor", () => {
		const base = applyFileExplorerSelection(EMPTY_FILE_EXPLORER_SELECTION, flat, "/b", {
			toggle: false,
			range: false,
			activate: true,
		});
		const ranged = applyFileExplorerSelection(base, flat, "/d", {
			toggle: false,
			range: true,
			activate: false,
		});
		expect(ranged.paths).toEqual(["/b", "/c", "/d"]);
		expect(ranged.anchorPath).toBe("/b");
		expect(ranged.focusedPath).toBe("/d");
	});
});

describe("moveFileExplorerFocus", () => {
	const flat = ["/a", "/b", "/c"];

	it("moves focus and replaces selection", () => {
		const next = moveFileExplorerFocus({ paths: ["/a"], anchorPath: "/a", focusedPath: "/a" }, flat, 1, false);
		expect(next).toEqual({ paths: ["/b"], anchorPath: "/b", focusedPath: "/b" });
	});

	it("extends selection when requested", () => {
		const next = moveFileExplorerFocus({ paths: ["/a"], anchorPath: "/a", focusedPath: "/a" }, flat, 2, true);
		expect(next.paths).toEqual(["/a", "/b", "/c"]);
		expect(next.focusedPath).toBe("/c");
	});
});

describe("selectAllVisible", () => {
	it("selects the entire flat list", () => {
		expect(selectAllVisible(["/a", "/b"])).toEqual({
			paths: ["/a", "/b"],
			anchorPath: "/a",
			focusedPath: "/b",
		});
	});
});

describe("applyMarqueeSelection", () => {
	const flat = ["/a", "/b", "/c", "/d"];

	it("orders the provided path set by the flat tree", () => {
		const next = applyMarqueeSelection(flat, ["/d", "/b"]);
		expect(next).toEqual({ paths: ["/b", "/d"], anchorPath: "/b", focusedPath: "/d" });
	});

	it("preserves a previous anchor when it remains selected", () => {
		const next = applyMarqueeSelection(flat, ["/a", "/c"], {
			paths: ["/a"],
			anchorPath: "/a",
			focusedPath: "/a",
		});
		expect(next.paths).toEqual(["/a", "/c"]);
		expect(next.anchorPath).toBe("/a");
		expect(next.focusedPath).toBe("/c");
	});

	it("clears when the path set is empty", () => {
		expect(applyMarqueeSelection(flat, [])).toEqual(EMPTY_FILE_EXPLORER_SELECTION);
	});
});
