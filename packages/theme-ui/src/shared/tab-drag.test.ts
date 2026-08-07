import { describe, expect, it } from "vitest";
import { hasReachedTabDragDistance, moveTabKey } from "./tab-drag";

describe("tab drag", () => {
	it("keeps clicks below the drag threshold", () => {
		expect(hasReachedTabDragDistance(2, 3)).toBe(false);
		expect(hasReachedTabDragDistance(4, 0)).toBe(true);
	});

	it("moves a tab while preserving the remaining order", () => {
		expect(moveTabKey(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
		expect(moveTabKey(["a", "b", "c"], "missing", "c")).toEqual(["a", "b", "c"]);
	});
});
