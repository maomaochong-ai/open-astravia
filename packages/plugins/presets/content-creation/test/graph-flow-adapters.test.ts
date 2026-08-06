import { describe, expect, it } from "vitest";
import { CONTENT_FLOW_SOURCE_HANDLE_ID, CONTENT_FLOW_TARGET_HANDLE_ID } from "../src/canvas/flow-handles";
import { resolveContentFlowConnection, toContentFlowEdges } from "../src/canvas/graph-flow-adapters";
import { applyContentProjectCommands } from "../src/project/commands";
import { createContentProject } from "../src/project/types";

describe("content graph flow adapters", () => {
	it("renders typed domain edges through the centered visual handles", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "prompt", kind: "prompt", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "video", kind: "video-generator", position: { x: 300, y: 0 } } },
			{ type: "edge.connect", source: "prompt", target: "video" },
		]);

		expect(project.graph.edges[0]).toMatchObject({ sourceHandle: "text", targetHandle: "prompt" });
		expect(toContentFlowEdges(project, new Set())[0]).toMatchObject({
			sourceHandle: CONTENT_FLOW_SOURCE_HANDLE_ID,
			targetHandle: CONTENT_FLOW_TARGET_HANDLE_ID,
		});
	});

	it("infers compatible typed ports from a visual node-to-node connection", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "prompt", kind: "prompt", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "video", kind: "video-generator", position: { x: 300, y: 0 } } },
		]);

		expect(resolveContentFlowConnection(project, { source: "prompt", target: "video" })).toEqual({
			sourceHandle: "text",
			targetHandle: "prompt",
		});
	});
});
