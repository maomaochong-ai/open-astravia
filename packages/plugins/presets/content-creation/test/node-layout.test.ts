import { describe, expect, it } from "vitest";
import type { ContentNode } from "../src/domain/model";
import { alignContentNodes, layoutContentNodes } from "../src/domain/node-layout";

function node(id: string, x: number, y: number, width: number, height: number): ContentNode {
	return { id, kind: "prompt", position: { x, y }, width, height, status: "idle", data: {} };
}

describe("content node layout", () => {
	it("aligns nodes using their rendered dimensions", () => {
		const placements = alignContentNodes([node("a", 10, 20, 100, 80), node("b", 240, 100, 200, 120)], "right");

		expect(placements).toEqual([
			{ nodeId: "a", position: { x: 340, y: 20 } },
			{ nodeId: "b", position: { x: 240, y: 100 } },
		]);
	});

	it("arranges a mixed-size selection into a deterministic row and grid", () => {
		const nodes = [node("b", 300, 100, 200, 120), node("a", 10, 20, 100, 80), node("c", 600, 140, 160, 90)];

		expect(layoutContentNodes(nodes, "row", 20)).toEqual([
			{ nodeId: "a", position: { x: 10, y: 20 } },
			{ nodeId: "b", position: { x: 130, y: 20 } },
			{ nodeId: "c", position: { x: 350, y: 20 } },
		]);
		expect(layoutContentNodes(nodes, "grid", 20)).toEqual([
			{ nodeId: "a", position: { x: 10, y: 20 } },
			{ nodeId: "b", position: { x: 230, y: 20 } },
			{ nodeId: "c", position: { x: 10, y: 160 } },
		]);
	});
});
