import { describe, expect, it } from "vitest";
import { createContentCreationAgentState } from "../src/agent/state";
import type { ContentModelDescriptor } from "../src/generation/types";
import { applyContentProjectCommands } from "../src/project/commands";
import { createContentProject } from "../src/project/types";

const IMAGE_MODEL: ContentModelDescriptor = {
	providerId: "image-provider",
	modelId: "image-model",
	displayName: "Image Model",
	outputKind: "image",
	modes: [{ id: "text-to-image", inputs: [] }],
	aspectRatios: ["1:1"],
};

const VIDEO_MODEL: ContentModelDescriptor = {
	providerId: "video-provider",
	modelId: "video-model",
	displayName: "Video Model",
	outputKind: "video",
	modes: [{ id: "text-to-video", inputs: [] }],
	aspectRatios: ["16:9"],
};

describe("content creation agent state", () => {
	it("exposes semantic, runtime, capability, and diagnostic state without private storage ids", () => {
		let project = applyContentProjectCommands(
			createContentProject("C:/project", "2026-01-01T00:00:00.000Z"),
			[
				{
					type: "node.add",
					node: {
						id: "image",
						kind: "image-generator",
						position: { x: 20, y: 30 },
						data: { providerId: "missing-provider", modelId: "missing-model" },
					},
				},
				{ type: "node.add", node: { id: "output", kind: "output", position: { x: 400, y: 30 } } },
			],
		);
		project = {
			...project,
			assets: [
				{
					id: "private",
					blobId: "secret-storage-id",
					kind: "image",
					name: "reference.png",
					mimeType: "image/png",
					createdAt: "2026-01-01T00:00:00.000Z",
				},
				{
					id: "generated",
					filePath: "output/result.png",
					kind: "image",
					name: "result.png",
					mimeType: "image/png",
					createdAt: "2026-01-01T00:00:00.000Z",
				},
			],
		};

		const state = createContentCreationAgentState(project, [IMAGE_MODEL]);
		const encoded = JSON.stringify(state);

		expect(encoded).not.toContain("secret-storage-id");
		expect(encoded).not.toContain('"view"');
		expect(encoded).not.toContain('"timeline"');
		expect(state.assets).toEqual([
			expect.objectContaining({ id: "private", name: "reference.png" }),
			expect.objectContaining({ id: "generated", workspacePath: "output/result.png" }),
		]);
		expect(state.runtime.nodes).toEqual([
			{ nodeId: "image", status: "idle" },
			{ nodeId: "output", status: "idle" },
		]);
		expect(state.capabilities.models[0]).toMatchObject({ providerId: "image-provider", modelId: "image-model" });
		expect(state.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
			expect.arrayContaining([
				"generation-prompt-missing",
				"selected-model-unavailable",
				"output-without-input",
				"deliverables-not-defined",
			]),
		);
	});

	it("reports actionable method gaps for an existing weak video prompt", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [{
			type: "node.add",
			node: {
				id: "video",
				kind: "video-generator",
				position: { x: 0, y: 0 },
				data: { prompt: "Create a premium product shot with a slow push-in." },
			},
		}]);

		const state = createContentCreationAgentState(project, [VIDEO_MODEL]);
		expect(state.diagnostics).toContainEqual(expect.objectContaining({
			code: "video-prompt-method-incomplete",
			severity: "warning",
			nodeId: "video",
			details: expect.objectContaining({
				recommendedSkill: "direct-video-creation",
				recommendedOperationField: "promptPlan",
				issues: expect.arrayContaining(["reference-role-missing", "final-frame-missing"]),
			}),
		}));
	});

	it("diagnoses a connected Prompt node that is shadowed by local generator text", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{
				type: "node.add",
				node: { id: "topic", kind: "prompt", position: { x: 0, y: 0 }, data: { prompt: "Dynamic topic" } },
			},
			{
				type: "node.add",
				node: {
					id: "video",
					kind: "video-generator",
					position: { x: 400, y: 0 },
					data: { prompt: completeVideoPrompt() },
				},
			},
			{ type: "edge.connect", source: "topic", target: "video", targetHandle: "prompt" },
		]);

		const state = createContentCreationAgentState(project, [VIDEO_MODEL]);
		expect(state.diagnostics).toContainEqual(expect.objectContaining({
			code: "connected-prompt-source-shadowed",
			nodeId: "video",
			details: { shadowedPromptSourceNodeIds: ["topic"], recommendedOperation: "configure_video_shot" },
		}));
	});

	it("exposes the actual first/last-frame strategy and diagnoses reused frame prompts", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{
				type: "node.add",
				node: { id: "first", kind: "image-generator", position: { x: 0, y: 0 }, data: { prompt: "Same frame" } },
			},
			{
				type: "node.add",
				node: { id: "last", kind: "image-generator", position: { x: 0, y: 300 }, data: { prompt: "Same frame" } },
			},
			{
				type: "node.add",
				node: {
					id: "video",
					kind: "video-generator",
					position: { x: 400, y: 0 },
					data: { modeId: "image-to-video", prompt: completeVideoPrompt() },
				},
			},
			{ type: "edge.connect", source: "first", target: "video", targetHandle: "image", role: "firstFrame" },
			{ type: "edge.connect", source: "last", target: "video", targetHandle: "image", role: "lastFrame" },
		]);

		const state = createContentCreationAgentState(project, [VIDEO_MODEL]);
		expect(state.videoPlans).toContainEqual({
			nodeId: "video",
			strategy: "first-last-frame",
			modeId: "image-to-video",
			sourceRoles: ["firstFrame", "lastFrame"],
			method: {
				promptPlanKind: "first-last-frame-plan",
				description: expect.stringContaining("two authoritative static endpoints"),
				inputContract: expect.stringContaining("keyframes.first"),
			},
		});
		expect(state.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining([
			"video-keyframe-prompt-contract-missing",
			"video-keyframe-prompts-reused",
		]));
	});

	it("diagnoses a configured video prompt that lacks its strategy-specific method", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{
				type: "node.add",
				node: { id: "image", kind: "image-generator", position: { x: 0, y: 0 } },
			},
			{
				type: "node.add",
				node: {
					id: "video",
					kind: "video-generator",
					position: { x: 400, y: 0 },
					data: { modeId: "image-to-video", prompt: completeVideoPrompt() },
				},
			},
			{ type: "edge.connect", source: "image", target: "video", targetHandle: "image", role: "firstFrame" },
		]);

		const state = createContentCreationAgentState(project, [VIDEO_MODEL]);
		expect(state.diagnostics).toContainEqual(expect.objectContaining({
			code: "video-prompt-method-incomplete",
			details: expect.objectContaining({ issues: expect.arrayContaining(["source-image-contract-missing"]) }),
		}));
	});
});

function completeVideoPrompt(): string {
	return [
		"Reference role: supplied frames define identity and composition.",
		"Protected invariants: identity and environment.",
		"Initial state: subjects begin apart.",
		"Primary action: subjects move together. Secondary motion: fabric responds.",
		"Camera: wide shot, moving toward center, motivated by the meeting; the camera rests at a centered two-shot.",
		"Lighting: warm side key. Light behavior: exposure remains stable.",
		"Final frame: subjects meet at center.",
	].join("\n");
}
