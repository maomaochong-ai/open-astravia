import { describe, expect, it } from "vitest";
import { listCompatibleNodeKinds, resolveContentConnection } from "../src/node/connections";
import {
	CONTENT_NODE_DEFINITIONS,
	createDefaultContentNodeData,
	getContentNodeDefinition,
} from "../src/node/definitions";
import { createContentProject, type ContentNode } from "../src/project/types";

function node(id: string, kind: ContentNode["kind"]): ContentNode {
	return { id, kind, position: { x: 0, y: 0 }, status: "idle", data: createDefaultContentNodeData(kind) };
}

describe("content node definitions", () => {
	it("keeps every node kind in a single registry with unique port ids", () => {
		expect(CONTENT_NODE_DEFINITIONS.map((definition) => definition.kind)).toEqual([
			"prompt",
			"image-generator",
			"video-generator",
			"asset",
			"output",
		]);
		for (const definition of CONTENT_NODE_DEFINITIONS) {
			const inputIds = definition.inputs.map((port) => port.id);
			const outputIds = definition.outputs.map((port) => port.id);
			expect(new Set(inputIds).size).toBe(inputIds.length);
			expect(new Set(outputIds).size).toBe(outputIds.length);
		}
	});

	it("creates defaults from definitions without sharing mutable data", () => {
		const first = createDefaultContentNodeData("video-generator");
		const second = createDefaultContentNodeData("video-generator");
		expect(first).toEqual({ duration: 5, resolution: "720p" });
		expect(first).not.toBe(second);
		expect(getContentNodeDefinition("video-generator").inputs.map((port) => port.id)).toEqual(["prompt", "image", "video"]);
		expect(getContentNodeDefinition("prompt").inputs).toMatchObject([
			{ id: "media", dataType: "media", multiple: true },
		]);
		expect(getContentNodeDefinition("prompt").outputs[0]).toMatchObject({
			id: "text",
			dataType: "prompt",
		});
		expect(getContentNodeDefinition("video-generator").inputs[0]).toMatchObject({
			id: "prompt",
			multiple: true,
		});
	});

	it("resolves typed ports and lists only compatible creation choices", () => {
		const project = createContentProject("C:/project");
		const prompt = node("prompt", "prompt");
		const video = node("video", "video-generator");
		project.graph.nodes.push(prompt, video);

		expect(resolveContentConnection(project, prompt, video)).toEqual({ sourceHandle: "text", targetHandle: "prompt" });
		expect(listCompatibleNodeKinds(project, prompt, "source", "text")).toEqual([
			"image-generator",
			"video-generator",
			"output",
		]);
	});
});
