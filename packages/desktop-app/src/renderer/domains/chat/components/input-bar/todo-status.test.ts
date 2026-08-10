import { selectTodoStatusSummary, type TodoStatusItem } from "@vetta/theme-ui/chat";
import { describe, expect, it } from "vitest";

function items(...statuses: TodoStatusItem["status"][]): TodoStatusItem[] {
	return statuses.map((status, index) => ({ id: index + 1, content: `item ${index + 1}`, status }));
}

describe("selectTodoStatusSummary", () => {
	it("prefers the in-progress item as the shown label", () => {
		const summary = selectTodoStatusSummary(items("done", "in_progress", "pending"));
		expect(summary.progressLabel).toBe("1/3");
		expect(summary.activeContent).toBe("item 2");
		expect(summary.allDone).toBe(false);
	});

	it("falls back to the first pending item when nothing is in progress", () => {
		const summary = selectTodoStatusSummary(items("done", "pending", "pending"));
		expect(summary.activeContent).toBe("item 2");
	});

	it("reports the all-done state that switches the dot to green", () => {
		const summary = selectTodoStatusSummary(items("done", "done"));
		expect(summary).toMatchObject({ allDone: true, percent: 100, progressLabel: "2/2", activeContent: null });
	});

	it("never reports all-done for an empty list", () => {
		expect(selectTodoStatusSummary([])).toMatchObject({ allDone: false, percent: 0, activeContent: null });
	});
});
