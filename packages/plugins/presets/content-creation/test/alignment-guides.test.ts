import { describe, expect, it } from "vitest";
import { findContentAlignmentGuides, findContentFlowAlignmentGuides } from "../src/canvas/alignment-guides";
import type { ContentNode } from "../src/project/types";

function node(id: string, x: number, y: number): ContentNode {
	return { id, kind: "prompt", position: { x, y }, width: 100, height: 80, status: "idle", data: {} };
}

describe("content alignment guides", () => {
	it("matches left, center, right, top, center, and bottom anchors within the zoom-adjusted threshold", () => {
		const guides = findContentAlignmentGuides([node("active", 102, 18), node("target", 100, 100)], "active", 3);

		expect(guides.vertical).toEqual({ x: 100, top: 18, bottom: 180 });
		expect(guides.horizontal).toEqual({ y: 100, left: 100, right: 202 });
	});

	it("returns no guide when anchors are outside the threshold", () => {
		expect(findContentAlignmentGuides([node("active", 0, 0), node("target", 200, 200)], "active", 4)).toEqual({});
	});

	it("uses live React Flow positions while preserving the same alignment anchors", () => {
		const active = {
			id: "active",
			position: { x: 102, y: 18 },
			width: 100,
			height: 80,
			data: { kind: "prompt", nodeData: {} },
		};
		const target = {
			id: "target",
			position: { x: 100, y: 100 },
			width: 100,
			height: 80,
			data: { kind: "prompt", nodeData: {} },
		};

		expect(findContentFlowAlignmentGuides([active, target] as never, "active", 3)).toEqual({
			vertical: { x: 100, top: 18, bottom: 180 },
			horizontal: { y: 100, left: 100, right: 202 },
		});
	});
});
