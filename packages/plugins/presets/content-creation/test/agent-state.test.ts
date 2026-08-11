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
});
