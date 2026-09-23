import { describe, expect, it, vi } from "vitest";
import {
	mergeSessionPins,
	parseSessionPins,
	removeSessionPins,
	serializeSessionPins,
	sessionPinsFromSnapshot,
	setSessionPinned,
} from "./session-pins.js";

describe("session pins", () => {
	it("parses only the current schema and valid records", () => {
		expect(
			Array.from(
				parseSessionPins({
					schemaVersion: 1,
					pins: [
						{ path: "C:/sessions/one.jsonl", pinnedAt: 10 },
						{ path: "", pinnedAt: 20 },
						{ path: "C:/sessions/bad.jsonl", pinnedAt: Number.NaN },
					],
				}),
			),
		).toEqual([["C:/sessions/one.jsonl", 10]]);
		expect(parseSessionPins({ schemaVersion: 2, pins: [] }).size).toBe(0);
		expect(parseSessionPins("invalid").size).toBe(0);
		expect(sessionPinsFromSnapshot(undefined).size).toBe(0);
	});

	it("round-trips through the file format", () => {
		const pins = new Map([
			["one", 1],
			["two", 2],
		]);
		expect(parseSessionPins(JSON.parse(JSON.stringify(serializeSessionPins(pins))))).toEqual(pins);
	});

	it("keeps recent pin ordering monotonic when the clock does not advance", () => {
		const clock = vi.spyOn(Date, "now").mockReturnValue(100);
		try {
			const first = setSessionPinned(new Map(), { path: "one", pinned: true });
			const second = setSessionPinned(first, { path: "two", pinned: true });
			expect(second.get("two")).toBeGreaterThan(second.get("one")!);
		} finally {
			clock.mockRestore();
		}
	});

	it("pins, refreshes pin order, and unpins without mutating the input", () => {
		const initial = new Map([["one", 1]]);
		const pinned = setSessionPinned(initial, { path: "two", pinned: true, pinnedAt: 2 });
		const refreshed = setSessionPinned(pinned, { path: "one", pinned: true, pinnedAt: 3 });
		const unpinned = setSessionPinned(refreshed, { path: "two", pinned: false });

		expect(Array.from(initial)).toEqual([["one", 1]]);
		expect(Array.from(refreshed)).toEqual([
			["one", 3],
			["two", 2],
		]);
		expect(Array.from(unpinned)).toEqual([["one", 3]]);
	});

	it("removes only known paths and keeps the same map when nothing changes", () => {
		const pins = new Map([
			["one", 1],
			["two", 2],
		]);
		expect(removeSessionPins(pins, ["missing"])).toBe(pins);
		expect(Array.from(removeSessionPins(pins, ["one", "missing"]))).toEqual([["two", 2]]);
		expect(pins.size).toBe(2);
	});

	it("merges legacy pins keeping the newer time for the same path", () => {
		const current = new Map([
			["one", 5],
			["two", 1],
		]);
		const merged = mergeSessionPins(
			current,
			new Map([
				["one", 3],
				["two", 4],
				["three", 2],
			]),
		);
		expect(Array.from(merged).sort()).toEqual([
			["one", 5],
			["three", 2],
			["two", 4],
		]);
		expect(mergeSessionPins(current, new Map([["one", 1]]))).toBe(current);
	});
});
