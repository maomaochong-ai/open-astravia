import { describe, expect, it } from "vitest";
import { composePlanFeedback, isApprovedPlanBlock, pinApprovedPlanBlocks, splitPlanIntoSegments } from "./plan-review";

describe("splitPlanIntoSegments", () => {
	it("separates the preamble, each top-level step and trailing sections", () => {
		const plan = [
			"## Goal",
			"Add plan mode.",
			"",
			"1. **Add the gate** in `composer.ts`",
			"   - filter tools",
			"   - block writes",
			"2. Wire the UI",
			"",
			"   ```ts",
			"   1. not a step",
			"   ```",
			"3) Write tests",
			"",
			"## Risks",
			"None.",
		].join("\n");

		const segments = splitPlanIntoSegments(plan);
		expect(segments.map((segment) => (segment.kind === "step" ? `step ${segment.number}` : "text"))).toEqual([
			"text",
			"step 1",
			"step 2",
			"step 3",
			"text",
		]);
		expect(segments[1]).toMatchObject({ title: "Add the gate in composer.ts" });
		expect(segments[1]?.markdown).toContain("- block writes");
		expect(segments[2]?.markdown).toContain("1. not a step");
		expect(segments[4]?.markdown).toBe("## Risks\nNone.");
		expect(segments.map(({ markdown }) => markdown).join("\n\n")).toContain("3) Write tests");
	});

	it("keeps a plan without numbered steps reviewable as a single block", () => {
		expect(splitPlanIntoSegments("Just refactor the module.\r\nThen test it.")).toEqual([
			{ kind: "text", key: "0", markdown: "Just refactor the module.\nThen test it." },
		]);
		expect(splitPlanIntoSegments("   \n")).toEqual([]);
	});
});

describe("composePlanFeedback", () => {
	it("anchors step comments by number and title and keeps the user's wording", () => {
		expect(
			composePlanFeedback("  先别动数据库  ", [
				{ number: 2, title: "Wire the UI", comment: " 拆成两步 " },
				{ number: 3, title: "Write tests", comment: "   " },
			]),
		).toBe("先别动数据库\n\nComments on specific steps:\n- Step 2 (Wire the UI): 拆成两步");
	});

	it("returns only the overall feedback when no step was commented", () => {
		expect(composePlanFeedback("换个方案", [])).toBe("换个方案");
		expect(composePlanFeedback("", [])).toBe("");
	});
});

describe("approved plan blocks in a collapsed turn", () => {
	const planCall = (decision: string) => ({
		type: "tool_call",
		toolName: "exit_plan_mode",
		uiDetails: { planReview: { decision } },
	});

	it("recognises only an approved exit_plan_mode call", () => {
		expect(isApprovedPlanBlock(planCall("approve"))).toBe(true);
		expect(isApprovedPlanBlock(planCall("revise"))).toBe(false);
		expect(isApprovedPlanBlock({ type: "tool_call", toolName: "exit_plan_mode" })).toBe(false);
		expect(isApprovedPlanBlock({ ...planCall("approve"), toolName: "write" })).toBe(false);
	});

	it("keeps the approved plan above the answer while the execution steps stay folded", () => {
		const approved = planCall("approve");
		const rejected = planCall("revise");
		const edit = { type: "tool_call", toolName: "edit" };
		const answer = { type: "text" };
		expect(pinApprovedPlanBlocks([rejected, approved, edit], [answer])).toEqual([approved, answer]);
		expect(pinApprovedPlanBlocks([edit], [answer])).toEqual([answer]);
	});
});
