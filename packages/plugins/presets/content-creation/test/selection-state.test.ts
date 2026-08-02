import { describe, expect, it } from "vitest";
import { reconcileSelectedNodeIds } from "../src/components/selection-state";

describe("content canvas selection state", () => {
	it("preserves the current reference for an equivalent React Flow selection", () => {
		const current = ["first", "second"];

		expect(reconcileSelectedNodeIds(current, ["first", "second"])).toBe(current);
		expect(reconcileSelectedNodeIds(current, ["second", "first"])).toBe(current);
	});

	it("returns a new selection when membership changes", () => {
		const current = ["first"];
		const next = reconcileSelectedNodeIds(current, ["second"]);

		expect(next).toEqual(["second"]);
		expect(next).not.toBe(current);
	});
});
