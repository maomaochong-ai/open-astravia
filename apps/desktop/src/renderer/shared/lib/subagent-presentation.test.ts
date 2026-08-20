import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { subagentErrorPresentation, subagentObjective, subagentUsageLabel } from "./subagent-presentation";

const t = ((key: string, values?: Record<string, unknown>) =>
	values ? `${key}:${String(values.tokens)}:${String(values.cost)}` : key) as TFunction<"chat">;

describe("subagent presentation", () => {
	it("shows the structured objective instead of the entire delegated contract", () => {
		expect(
			subagentObjective("<history>old</history>\n<objective>Verify the API behavior.</objective>\n<scope>x</scope>"),
		).toBe("Verify the API behavior.");
		expect(subagentObjective("Legacy plain task")).toBe("Legacy plain task");
	});

	it("formats aggregate usage only when there is observable consumption", () => {
		expect(
			subagentUsageLabel({ input: 1_100, output: 200, cacheRead: 0, cacheWrite: 0, costTotal: 0.004 }, t),
		).toMatch(/^activityPanel\.subagents\.usage:(1\.3K|1300):(US)?\$0\.004$/u);
		expect(subagentUsageLabel({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costTotal: 0 }, t)).toBe("");
	});

	it("classifies and clips unsafe raw errors before rendering", () => {
		expect(subagentErrorPresentation("Permission denied while opening file", t)).toMatchObject({
			label: "activityPanel.subagents.errorPermission",
		});
		expect(subagentErrorPresentation("network timeout", t)).toMatchObject({
			label: "activityPanel.subagents.errorConnection",
		});
		expect(subagentErrorPresentation("x".repeat(500), t)?.detail).toHaveLength(360);
	});
});
