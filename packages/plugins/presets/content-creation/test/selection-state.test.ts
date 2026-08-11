import { describe, expect, it } from "vitest";
import {
	applySelectedNodeIdsToFlowEdges,
	applySelectedNodeIdsToFlowNodes,
	reconcileSelectedNodeIds,
} from "../src/canvas/selection-state";

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

	it("applies a programmatic selection to React Flow nodes without recreating unchanged nodes", () => {
		const first = { id: "first", selected: false, locked: true };
		const second = { id: "second", selected: true, locked: false };
		const nodes = [first, second];

		const selected = applySelectedNodeIdsToFlowNodes(nodes, new Set(["first", "second"]));

		expect(selected).not.toBe(nodes);
		expect(selected[0]).toEqual({ ...first, selected: true });
		expect(selected[1]).toBe(second);
		expect(applySelectedNodeIdsToFlowNodes(selected, new Set(["first", "second"]))).toBe(selected);
	});

	it("updates only edges whose selection-related chrome changed", () => {
		const related = { id: "related", source: "first", target: "second" };
		const unrelated = { id: "unrelated", source: "third", target: "fourth" };
		const edges = [related, unrelated];

		const selected = applySelectedNodeIdsToFlowEdges(edges, new Set(["first"]));

		expect(selected).not.toBe(edges);
		expect(selected[0]).toEqual({ ...related, className: "is-related" });
		expect(selected[1]).toBe(unrelated);
		expect(applySelectedNodeIdsToFlowEdges(selected, new Set(["first"]))).toBe(selected);
	});
});
