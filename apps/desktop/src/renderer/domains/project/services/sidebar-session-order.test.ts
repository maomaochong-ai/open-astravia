import type { SessionInfo } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { buildSidebarSessionOrdering, orderSidebarSessions } from "./sidebar-session-order";

function session(path: string, modifiedAt: number): SessionInfo {
	return { id: path, path, cwd: "C:/workspace", firstMessage: path, modifiedAt };
}

describe("sidebar session ordering", () => {
	it("places recently pinned sessions first and keeps unpinned sessions newest-first", () => {
		const sessions = [session("old", 1), session("new", 3), session("middle", 2)];
		const pins = new Map([
			["old", 20],
			["middle", 10],
		]);
		expect(orderSidebarSessions(sessions, pins).map(({ path }) => path)).toEqual(["old", "middle", "new"]);
	});

	it("never hides pinned sessions behind the collapsed limit", () => {
		const sessions = Array.from({ length: 8 }, (_, index) => session(String(index), 100 - index));
		const pins = new Map(sessions.slice(0, 6).map(({ path }, index) => [path, index + 1]));
		const ordering = buildSidebarSessionOrdering(sessions, pins, 5, false);

		expect(ordering.visible).toHaveLength(6);
		expect(ordering.visible.every(({ path }) => pins.has(path))).toBe(true);
		expect(ordering.hiddenCount).toBe(2);
		expect(ordering.hasMore).toBe(true);
	});

	it("returns every session when expanded", () => {
		const sessions = [session("one", 1), session("two", 2)];
		const ordering = buildSidebarSessionOrdering(sessions, new Map(), 1, true);
		expect(ordering.visible.map(({ path }) => path)).toEqual(["two", "one"]);
		expect(ordering.hiddenCount).toBe(0);
	});
});
