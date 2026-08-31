// @vitest-environment jsdom
import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import {
	parseSidebarSessionPins,
	pinnedSessionPathsAtom,
	removePinnedSessionsAtom,
	setSessionPinnedAtom,
	updatePinnedSessionPaths,
} from "./project-atoms";

describe("sidebar session pins", () => {
	it("persists local pins and removes only deleted session paths", () => {
		const store = createStore();
		store.set(pinnedSessionPathsAtom, new Map());
		store.set(setSessionPinnedAtom, { path: "one", pinned: true, pinnedAt: 10 });
		store.set(setSessionPinnedAtom, { path: "two", pinned: true, pinnedAt: 20 });
		store.set(removePinnedSessionsAtom, ["one"]);
		expect([...store.get(pinnedSessionPathsAtom)]).toEqual([["two", 20]]);
		expect([...parseSidebarSessionPins(JSON.parse(localStorage.getItem("vetta-sidebar-session-pins")!))]).toEqual([
			["two", 20],
		]);
	});
	it("keeps recent pin ordering monotonic when the clock does not advance", () => {
		const clock = vi.spyOn(Date, "now").mockReturnValue(100);
		try {
			const first = updatePinnedSessionPaths(new Map(), { path: "one", pinned: true });
			const second = updatePinnedSessionPaths(first, { path: "two", pinned: true });
			expect(second.get("two")).toBeGreaterThan(second.get("one")!);
		} finally {
			clock.mockRestore();
		}
	});
	it("parses only the current schema and valid records", () => {
		expect(
			Array.from(
				parseSidebarSessionPins({
					schemaVersion: 1,
					pins: [
						{ path: "C:/sessions/one.jsonl", pinnedAt: 10 },
						{ path: "", pinnedAt: 20 },
						{ path: "C:/sessions/bad.jsonl", pinnedAt: Number.NaN },
					],
				}),
			),
		).toEqual([["C:/sessions/one.jsonl", 10]]);
		expect(parseSidebarSessionPins({ schemaVersion: 2, pins: [] }).size).toBe(0);
		expect(parseSidebarSessionPins("invalid").size).toBe(0);
	});

	it("pins, refreshes pin order, and unpins without mutating the input", () => {
		const initial = new Map([["one", 1]]);
		const pinned = updatePinnedSessionPaths(initial, { path: "two", pinned: true, pinnedAt: 2 });
		const refreshed = updatePinnedSessionPaths(pinned, { path: "one", pinned: true, pinnedAt: 3 });
		const unpinned = updatePinnedSessionPaths(refreshed, { path: "two", pinned: false });

		expect(Array.from(initial)).toEqual([["one", 1]]);
		expect(Array.from(refreshed)).toEqual([
			["one", 3],
			["two", 2],
		]);
		expect(Array.from(unpinned)).toEqual([["one", 3]]);
	});
});
