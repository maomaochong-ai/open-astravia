import { describe, expect, it } from "vitest";
import { narrowOverflowBadge, partitionHeaderActionsForNarrow } from "./header-action-narrow";

describe("partitionHeaderActionsForNarrow", () => {
	it("keeps the pin beside the panel and folds the other actions, including stowed ones, into the menu", () => {
		const split = partitionHeaderActionsForNarrow(
			[{ key: "export" }, { key: "pin", retainWhenNarrow: true }, { key: "terminal" }],
			[{ key: "bottom" }, { key: "stowed-pin", retainWhenNarrow: true }],
		);
		expect(split.retained.map((item) => item.key)).toEqual(["pin", "stowed-pin"]);
		expect(split.overflow.map((item) => item.key)).toEqual(["export", "terminal", "bottom"]);
	});
});

describe("narrowOverflowBadge", () => {
	it("sums counts and falls back to a dot when nothing is numbered", () => {
		expect(narrowOverflowBadge([{ badge: 2 }, { badge: true }, { badge: 3 }])).toBe(5);
		expect(narrowOverflowBadge([{ badge: true }])).toBe(true);
		expect(narrowOverflowBadge([{}])).toBeUndefined();
	});
});
