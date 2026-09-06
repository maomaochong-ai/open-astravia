import { describe, expect, it } from "vitest";
import {
	CONVERSATION_TARGET_KEY,
	filterTargetOptions,
	parseNewSessionTarget,
	parseTeamTargetKey,
	targetDraftScope,
	teamTargetKey,
} from "./target";

describe("new-session targets", () => {
	it("uses conversation as the default and parses team keys", () => {
		expect(parseNewSessionTarget(undefined)).toBe(CONVERSATION_TARGET_KEY);
		expect(parseTeamTargetKey(teamTargetKey("team-1"))).toBe("team-1");
		expect(parseTeamTargetKey("conversation")).toBeNull();
	});

	it("filters target options by title and subtitle", () => {
		const options = [
			{ targetKey: teamTargetKey("a"), title: "Research", subtitle: "3 members", selected: false },
			{ targetKey: teamTargetKey("b"), title: "Build", selected: false },
		] as const;
		expect(filterTargetOptions(options, "3 MEMBERS")).toHaveLength(1);
		expect(filterTargetOptions(options, "build")[0]?.title).toBe("Build");
	});

	it("keeps ordinary and team drafts in different scopes", () => {
		expect(targetDraftScope(CONVERSATION_TARGET_KEY, "C:/workspace")).toBe("new:C:/workspace");
		expect(targetDraftScope(teamTargetKey("team-1"), "C:/workspace")).toBe("new-target:team:team-1");
	});
});
