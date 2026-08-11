import { describe, expect, it } from "vitest";
import { planIncrementalContentGraphLayout } from "../src/node/incremental-graph-layout";
import type { ContentEdge, ContentNode, ContentProjectDocument } from "../src/project/types";
import { createContentProject } from "../src/project/types";

function node(
	id: string,
	x: number,
	y: number,
	layoutOwnership: "automatic" | "user" = "user",
	locked = false,
): ContentNode {
	return {
		id,
		kind: "prompt",
		position: { x, y },
		width: 100,
		height: 100,
		locked,
		layoutOwnership,
		status: "idle",
		data: {},
	};
}

function edge(source: string, target: string): ContentEdge {
	return { id: `${source}-${target}`, source, target };
}

function project(nodes: ContentNode[], edges: ContentEdge[]): ContentProjectDocument {
	const value = createContentProject("C:/project");
	value.graph = { nodes, edges };
	return value;
}

function applyPlacements(value: ContentProjectDocument, placements: ReturnType<typeof planIncrementalContentGraphLayout>["placements"]) {
	const positions = new Map(placements.map((placement) => [placement.nodeId, placement.position]));
	return value.graph.nodes.map((current) => ({
		...current,
		position: positions.get(current.id) ?? current.position,
	}));
}

describe("incremental content graph layout", () => {
	it("lays out a newly generated workflow by topology and rendered size", () => {
		const before = project([], []);
		const after = project(
			[
				node("prompt", 0, 0, "automatic"),
				{ ...node("image", 0, 0, "automatic"), width: 200, height: 200 },
				node("output", 0, 0, "automatic"),
			],
			[edge("prompt", "image"), edge("image", "output")],
		);

		const result = planIncrementalContentGraphLayout(before, after, new Set(["prompt", "image", "output"]));
		const [prompt, image, output] = applyPlacements(after, result.placements);

		expect(image!.position.x).toBeGreaterThanOrEqual(prompt!.position.x + 100 + 96);
		expect(output!.position.x).toBeGreaterThanOrEqual(image!.position.x + 200 + 96);
		expect(result.diagnostics).toEqual([]);
		expect(new Set([prompt!.position.y, image!.position.y, output!.position.y]).size).toBeGreaterThan(1);
	});

	it("inserts nodes into available space without moving user anchors", () => {
		const before = project([node("before", 0, 0), node("after", 500, 0)], [edge("before", "after")]);
		const after = project(
			[node("before", 0, 0), node("inserted", 0, 0, "automatic"), node("after", 500, 0)],
			[edge("before", "inserted"), edge("inserted", "after")],
		);

		const result = planIncrementalContentGraphLayout(before, after, new Set(["inserted"]));
		const laidOut = applyPlacements(after, result.placements);

		expect(laidOut.find((current) => current.id === "before")?.position).toEqual({ x: 0, y: 0 });
		expect(laidOut.find((current) => current.id === "after")?.position).toEqual({ x: 500, y: 0 });
		expect(laidOut.find((current) => current.id === "inserted")?.position.x).toBe(248);
		expect(result.movedExistingNodeIds).toEqual([]);
	});

	it("opens only the downstream corridor when an insertion needs more room", () => {
		const before = project([node("before", 0, 0), node("after", 300, 0)], [edge("before", "after")]);
		const after = project(
			[node("before", 0, 0), node("inserted", 0, 0, "automatic"), node("after", 300, 0)],
			[edge("before", "inserted"), edge("inserted", "after")],
		);

		const result = planIncrementalContentGraphLayout(before, after, new Set(["inserted"]));
		const laidOut = applyPlacements(after, result.placements);

		expect(laidOut.find((current) => current.id === "before")?.position).toEqual({ x: 0, y: 0 });
		expect(laidOut.find((current) => current.id === "inserted")?.position.x).toBe(200);
		expect(laidOut.find((current) => current.id === "after")?.position.x).toBe(400);
		expect(result.movedExistingNodeIds).toEqual(["after"]);
	});

	it("places several inserted nodes as one local left-to-right corridor", () => {
		const before = project([node("before", 0, 0), node("after", 300, 0)], [edge("before", "after")]);
		const after = project(
			[
				node("before", 0, 0),
				node("first", 0, 0, "automatic"),
				node("second", 0, 0, "automatic"),
				node("after", 300, 0),
			],
			[edge("before", "first"), edge("first", "second"), edge("second", "after")],
		);

		const result = planIncrementalContentGraphLayout(before, after, new Set(["first", "second"]));
		const laidOut = applyPlacements(after, result.placements);
		const positions = new Map(laidOut.map((current) => [current.id, current.position.x]));

		expect(positions.get("before")).toBe(0);
		expect(positions.get("first")).toBe(200);
		expect(positions.get("second")).toBe(400);
		expect(positions.get("after")).toBe(600);
		expect(result.movedExistingNodeIds).toEqual(["after"]);
	});

	it("keeps unrelated branches stable while packing a new branch vertically", () => {
		const before = project(
			[node("source", 0, 0), node("existing", 300, 0), node("unrelated", 900, 500)],
			[edge("source", "existing")],
		);
		const after = project(
			[
				node("source", 0, 0),
				node("existing", 300, 0),
				node("branch", 0, 0, "automatic"),
				node("unrelated", 900, 500),
			],
			[edge("source", "existing"), edge("source", "branch")],
		);

		const result = planIncrementalContentGraphLayout(before, after, new Set(["branch"]));
		const laidOut = applyPlacements(after, result.placements);

		expect(laidOut.find((current) => current.id === "existing")?.position).toEqual({ x: 300, y: 0 });
		expect(laidOut.find((current) => current.id === "unrelated")?.position).toEqual({ x: 900, y: 500 });
		expect(laidOut.find((current) => current.id === "branch")?.position.y).toBeGreaterThan(100);
	});

	it("reports an unsatisfied direction constraint instead of moving a locked anchor", () => {
		const before = project([node("before", 0, 0), node("after", 300, 0, "user", true)], [edge("before", "after")]);
		const after = project(
			[node("before", 0, 0), node("inserted", 0, 0, "automatic"), node("after", 300, 0, "user", true)],
			[edge("before", "inserted"), edge("inserted", "after")],
		);

		const result = planIncrementalContentGraphLayout(before, after, new Set(["inserted"]));
		const laidOut = applyPlacements(after, result.placements);

		expect(laidOut.find((current) => current.id === "after")?.position).toEqual({ x: 300, y: 0 });
		expect(result.diagnostics).toContainEqual({
			code: "locked-layout-constraint",
			nodeIds: ["inserted", "after"],
		});
	});
});
