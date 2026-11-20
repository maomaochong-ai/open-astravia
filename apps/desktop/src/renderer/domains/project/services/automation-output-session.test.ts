import type { AutomationSessionLink } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { isAutomationOutputSession } from "./automation-session-groups";

const links = new Map<string, AutomationSessionLink>([
	["/s/new", { sessionPath: "/s/new", taskId: "t1", taskName: "Digest", mode: "new-session" }],
	["/s/same", { sessionPath: "/s/same", taskId: "t2", taskName: "Sweep", mode: "same-session" }],
]);

describe("isAutomationOutputSession", () => {
	it("treats new-session runs as automation output", () => {
		expect(isAutomationOutputSession("/s/new", links)).toBe(true);
	});

	it("keeps same-session sessions and unlinked sessions as normal sessions", () => {
		expect(isAutomationOutputSession("/s/same", links)).toBe(false);
		expect(isAutomationOutputSession("/s/manual", links)).toBe(false);
	});
});
