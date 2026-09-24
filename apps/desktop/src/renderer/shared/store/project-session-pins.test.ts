// @vitest-environment jsdom
import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPinsSnapshot } from "../../../shared/session-pins";
import {
	clearLegacySidebarSessionPins,
	pinnedSessionPathsAtom,
	removePinnedSessionsAtom,
	setSessionPinnedAtom,
	takeLegacySidebarSessionPins,
} from "./project-atoms";

const sessionPins = {
	set: vi.fn(async (_input: { path: string; pinned: boolean }): Promise<SessionPinsSnapshot> => ({ pins: [] })),
	forget: vi.fn(async (_paths: readonly string[]): Promise<SessionPinsSnapshot> => ({ pins: [] })),
};

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	Object.defineProperty(window, "vetta", { configurable: true, value: { sessionPins } });
});

describe("sidebar session pins", () => {
	it("pins at once and then follows what the main process kept", async () => {
		sessionPins.set.mockResolvedValueOnce({ pins: [{ path: "one", pinnedAt: 42 }] });
		const store = createStore();
		store.set(setSessionPinnedAtom, { path: "one", pinned: true });
		expect(store.get(pinnedSessionPathsAtom).has("one")).toBe(true);
		expect(sessionPins.set).toHaveBeenCalledWith({ path: "one", pinned: true });
		await vi.waitFor(() => expect([...store.get(pinnedSessionPathsAtom)]).toEqual([["one", 42]]));
	});

	it("forgets only pinned paths and skips the round trip when none are", () => {
		const store = createStore();
		store.set(
			pinnedSessionPathsAtom,
			new Map([
				["one", 1],
				["two", 2],
			]),
		);
		store.set(removePinnedSessionsAtom, ["missing"]);
		expect(sessionPins.forget).not.toHaveBeenCalled();
		store.set(removePinnedSessionsAtom, ["one"]);
		expect([...store.get(pinnedSessionPathsAtom)]).toEqual([["two", 2]]);
		expect(sessionPins.forget).toHaveBeenCalledWith(["one"]);
	});

	it("reads and clears the pins an older version kept in localStorage", () => {
		localStorage.setItem(
			"vetta-sidebar-session-pins",
			JSON.stringify({ schemaVersion: 1, pins: [{ path: "old", pinnedAt: 7 }] }),
		);
		expect([...takeLegacySidebarSessionPins()]).toEqual([["old", 7]]);
		clearLegacySidebarSessionPins();
		expect(takeLegacySidebarSessionPins().size).toBe(0);
	});
});
