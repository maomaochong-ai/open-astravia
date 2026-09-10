import { describe, expect, it } from "vitest";
import type { DesktopSessionHistoryInfo } from "@/shared/session-access";
import { pickLatestOpenableSession } from "./latest-session";

function session(
	path: string,
	modifiedAt: number,
	access: DesktopSessionHistoryInfo["access"] = { readHistory: true, resume: true, rename: true, delete: true },
): DesktopSessionHistoryInfo {
	return { id: path, path, cwd: "/w", firstMessage: "", modifiedAt, access };
}

const NO_ACCESS = { readHistory: false, resume: false, rename: false, delete: false };
const HISTORY_ONLY = { readHistory: true, resume: false, rename: false, delete: false };

describe("pickLatestOpenableSession", () => {
	it("returns the most recently modified session regardless of input order", () => {
		const picked = pickLatestOpenableSession([session("/a", 10), session("/c", 30), session("/b", 20)]);
		expect(picked?.session.path).toBe("/c");
		expect(picked?.target).toBe("interactive");
	});

	it("skips sessions that cannot be opened and takes the next newest", () => {
		const picked = pickLatestOpenableSession([
			session("/locked", 99, NO_ACCESS),
			session("/open", 50),
			session("/older", 10),
		]);
		expect(picked?.session.path).toBe("/open");
	});

	it("falls back to the viewer for a history-only session", () => {
		const picked = pickLatestOpenableSession([session("/readonly", 42, HISTORY_ONLY)]);
		expect(picked).toEqual({ session: expect.objectContaining({ path: "/readonly" }), target: "viewer" });
	});

	it("returns null for an empty project or when nothing can be opened", () => {
		expect(pickLatestOpenableSession([])).toBeNull();
		expect(pickLatestOpenableSession([session("/x", 1, NO_ACCESS)])).toBeNull();
	});

	it("does not mutate the caller's array", () => {
		const input = [session("/a", 1), session("/b", 2)];
		pickLatestOpenableSession(input);
		expect(input.map((entry) => entry.path)).toEqual(["/a", "/b"]);
	});
});
