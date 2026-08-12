import { describe, expect, it } from "vitest";
import {
	CONTENT_AGENT_OPERATION_SCHEMA,
	parseContentAgentOperations,
} from "../src/agent/operations";
import { CONTENT_AGENT_OPERATION_TYPES } from "../src/agent/operation-schema";
import { applyContentProjectCommands } from "../src/project/commands";
import { createContentProject } from "../src/project/types";
import type { ContentModelDescriptor } from "../src/generation/types";
import { resolveContentPrompt, listConnectedPromptSources } from "../src/node/prompt-sources";

const FRAME_VIDEO_MODEL: ContentModelDescriptor = {
	providerId: "host-media",
	modelId: "frame-video",
	displayName: "Frame video",
	outputKind: "video",
	aspectRatios: ["16:9"],
	modes: [
		{
			id: "image-to-video",
			inputs: [
				{ id: "firstFrame", accepts: ["image"], minItems: 0, maxItems: 1 },
				{ id: "lastFrame", accepts: ["image"], minItems: 0, maxItems: 1 },
			],
			minTotalItems: 1,
		},
		{
			id: "reference-to-video",
			inputs: [
				{ id: "referenceImages", accepts: ["image"], minItems: 0, maxItems: 9 },
				{ id: "referenceVideos", accepts: ["video"], minItems: 0, maxItems: 3 },
				{ id: "referenceAudios", accepts: ["audio"], minItems: 0, maxItems: 3 },
			],
			minTotalItems: 1,
		},
	],
};

describe("content agent operations", () => {
	it("translates semantic edits and places new nodes without canvas coordinates", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{
				type: "node.add",
				node: { id: "prompt", kind: "prompt", position: { x: 10, y: 20 } },
			},
		]);
		const commands = parseContentAgentOperations(project, [
			{
				type: "add_node",
				id: "video",
				kind: "video-generator",
				afterNodeId: "prompt",
				name: "主视频",
				purpose: "生成最终成片",
				prompt: "A cinematic product reveal",
				modelSelection: "specific",
				providerId: "host-media",
				modelId: "video-model",
				modeId: "text-to-video",
			},
		]);

		const next = applyContentProjectCommands(project, commands);
		const video = next.graph.nodes.find((node) => node.id === "video");
		expect(video).toMatchObject({
			name: "主视频",
			purpose: "生成最终成片",
			position: { x: 410, y: 20 },
			data: {
				prompt: "A cinematic product reveal",
				providerId: "host-media",
				modelId: "video-model",
				modeId: "text-to-video",
			},
		});
	});

	it("clears a specific model when automatic selection is requested", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{
				type: "node.add",
				node: {
					id: "image",
					kind: "image-generator",
					position: { x: 0, y: 0 },
					data: { providerId: "provider", modelId: "model", modeId: "text-to-image" },
				},
			},
		]);
		const commands = parseContentAgentOperations(project, [
			{ type: "update_node", nodeId: "image", modelSelection: "automatic" },
		]);

		const next = applyContentProjectCommands(project, commands);
		expect(next.graph.nodes[0]?.data).toMatchObject({
			providerId: undefined,
			modelId: undefined,
			modeId: undefined,
		});
	});

	it("validates model configuration without adding an edit confirmation path", () => {
		const project = createContentProject("C:/project");
		expect(() =>
			parseContentAgentOperations(project, [
				{ type: "add_node", kind: "video-generator", modelSelection: "specific" },
			]),
		).toThrow("specific model selection requires providerId and modelId");
	});

	it("compiles a structured video prompt plan through the operation parser", () => {
		const commands = parseContentAgentOperations(createContentProject("C:/project"), [{
			type: "add_node",
			id: "video",
			kind: "video-generator",
			duration: 5,
			promptPlan: {
				kind: "video-shot",
				sceneFunction: "Premium product reveal for a social ad",
				referenceRole: "Use the supplied product image as the identity and initial composition reference",
				protectedInvariants: ["Preserve product geometry", "Preserve branding and color"],
				initialState: "The product is centered and motionless on a dark studio surface",
				primaryAction: "A narrow highlight travels across the product face",
				secondaryMotion: "Fine atmospheric particles drift slowly behind the product",
				camera: {
					framing: "Start in a medium product close-up",
					movement: "a controlled dolly-in",
					direction: "forward along the product axis",
					speed: "slowly with gentle ease-out",
					motivation: "revealing the logo and material finish",
					restPoint: "a stable hero close-up with the full logo readable",
				},
				lighting: {
					setup: "Soft key light with a narrow rim light",
					behavior: "Specular highlights remain controlled and never clip",
				},
				finalState: "Hold the recognizable product in a clean hero frame for the final second",
				constraints: ["No text overlays", "No product redesign"],
			},
		}]);

		const next = applyContentProjectCommands(createContentProject("C:/project"), commands);
		const prompt = next.graph.nodes[0]?.data.prompt;
		expect(prompt).toContain("5-second single coherent shot");
		expect(prompt).toContain("Reference role:");
		expect(prompt).toContain("Final frame:");
		expect(CONTENT_AGENT_OPERATION_SCHEMA.items.oneOf).toHaveLength(CONTENT_AGENT_OPERATION_TYPES.length);
	});

	it("assigns stable ids and maps semantic connection inputs to internal handles", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "source", kind: "prompt", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "target", kind: "image-generator", position: { x: 400, y: 0 } } },
		]);
		const commands = parseContentAgentOperations(project, [
			{ type: "duplicate_node", nodeId: "source" },
			{ type: "connect_nodes", source: "source", target: "target", targetInput: "promptSources" },
		]);

		expect(commands).toEqual([
			expect.objectContaining({ type: "node.duplicate", id: expect.any(String) }),
			expect.objectContaining({ type: "edge.connect", id: expect.any(String), targetHandle: "prompt" }),
		]);
		const serializedSchema = JSON.stringify(CONTENT_AGENT_OPERATION_SCHEMA);
		expect(serializedSchema).not.toContain("sourceHandle");
		expect(serializedSchema).not.toContain("targetHandle");
		expect(serializedSchema).not.toContain('"x"');
		expect(serializedSchema).not.toContain('"y"');
		expect(CONTENT_AGENT_OPERATION_TYPES).not.toContain("edit_image");
	});

	it("accepts canonical node and edge ids for ordinary connections", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "prompt", kind: "prompt", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 400, y: 0 } } },
		]);

		const commands = parseContentAgentOperations(project, [{
			type: "connect_nodes",
			edgeId: "prompt-to-image",
			sourceNodeId: "prompt",
			targetNodeId: "image",
			targetInput: "promptSources",
		}]);

		expect(commands).toEqual([expect.objectContaining({
			type: "edge.connect",
			id: "prompt-to-image",
			source: "prompt",
			target: "image",
			targetHandle: "prompt",
		})]);
	});

	it("normalizes legacy and internal target input names after tool validation", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "prompt", kind: "prompt", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 400, y: 0 } } },
			{ type: "node.add", node: { id: "output", kind: "output", position: { x: 800, y: 0 } } },
		]);

		const commands = parseContentAgentOperations(project, [
			{ type: "connect_nodes", source: "prompt", target: "image", targetInput: "prompt" },
			{ type: "connect_nodes", source: "image", target: "output", targetInput: "content" },
		]);

		expect(commands).toEqual([
			expect.objectContaining({ type: "edge.connect", targetHandle: "prompt" }),
			expect.objectContaining({ type: "edge.connect", targetHandle: "content" }),
		]);
	});

	it("compiles video intent into model-backed role bindings in the same node batch", () => {
		const project = createContentProject("C:/project");
		const commands = parseContentAgentOperations(project, [
			{ type: "add_node", id: "first", kind: "image-generator" },
			{ type: "add_node", id: "last", kind: "image-generator" },
			{ type: "add_node", id: "video", kind: "video-generator" },
			{
				type: "configure_generation",
				targetNodeId: "video",
				generationIntent: "interpolate-frames",
				sources: [{ sourceNodeId: "first" }, { sourceNodeId: "last" }],
			},
		], [FRAME_VIDEO_MODEL]);

		const next = applyContentProjectCommands(project, commands);
		expect(next.graph.edges).toEqual([
			expect.objectContaining({ source: "first", target: "video", role: "firstFrame" }),
			expect.objectContaining({ source: "last", target: "video", role: "lastFrame" }),
		]);
	});

	it("materializes distinct static keyframes and a continuous video prompt atomically", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "first", kind: "image-generator", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "last", kind: "image-generator", position: { x: 0, y: 300 } } },
			{ type: "node.add", node: { id: "video", kind: "video-generator", position: { x: 400, y: 0 } } },
		]);
		const commands = parseContentAgentOperations(project, [{
			type: "configure_video_shot",
			targetNodeId: "video",
			strategy: "automatic",
			aspectRatio: "16:9",
			duration: 5,
			controlRequirements: { exactOpening: true, exactEnding: true },
			promptPlan: createVideoPromptPlan(),
			keyframes: {
				first: { nodeId: "first", promptPlan: createKeyframePlan("first") },
				last: { nodeId: "last", promptPlan: createKeyframePlan("last") },
			},
		}], [FRAME_VIDEO_MODEL]);

		const next = applyContentProjectCommands(project, commands);
		const firstPrompt = next.graph.nodes.find((node) => node.id === "first")?.data.prompt;
		const lastPrompt = next.graph.nodes.find((node) => node.id === "last")?.data.prompt;
		const videoPrompt = next.graph.nodes.find((node) => node.id === "video")?.data.prompt;
		expect(firstPrompt).toContain("Keyframe phase: first frame.");
		expect(lastPrompt).toContain("Keyframe phase: last frame.");
		expect(firstPrompt).not.toBe(lastPrompt);
		expect(videoPrompt).toContain("Primary action:");
		expect(videoPrompt).not.toContain("Keyframe phase:");
		expect(next.graph.edges).toEqual(expect.arrayContaining([
			expect.objectContaining({ source: "first", target: "video", role: "firstFrame" }),
			expect.objectContaining({ source: "last", target: "video", role: "lastFrame" }),
		]));
	});

	it("compiles an omni-reference manifest into stable media tokens", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "person-a", kind: "image-generator", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "person-b", kind: "image-generator", position: { x: 0, y: 300 } } },
			{ type: "node.add", node: { id: "scene", kind: "image-generator", position: { x: 0, y: 600 } } },
			{ type: "node.add", node: { id: "video", kind: "video-generator", position: { x: 400, y: 0 } } },
		]);
		const commands = parseContentAgentOperations(project, [{
			type: "configure_video_shot",
			targetNodeId: "video",
			strategy: "automatic",
			aspectRatio: "16:9",
			controlRequirements: { requiresSceneReference: true },
			promptPlan: createVideoPromptPlan(),
			sources: [
				{ sourceNodeId: "person-a", alias: "dancerA", semanticRole: "identity", instruction: "Preserve face and costume" },
				{ sourceNodeId: "person-b", alias: "dancerB", semanticRole: "identity", instruction: "Preserve face and costume" },
				{ sourceNodeId: "scene", alias: "ballroom", semanticRole: "environment", instruction: "Use the room layout and lighting" },
			],
		}], [FRAME_VIDEO_MODEL]);

		const next = applyContentProjectCommands(project, commands);
		const video = next.graph.nodes.find((node) => node.id === "video");
		expect(video?.data.modeId).toBe("reference-to-video");
		expect(video?.data.prompt).toContain("<Picture 1>: dancerA (identity). Preserve face and costume.");
		expect(video?.data.prompt).toContain("<Picture 3>: ballroom (environment). Use the room layout and lighting.");
		expect(next.graph.edges.filter((edge) => edge.target === "video")).toHaveLength(3);
	});

	it("absorbs redundant media and prompt connections into one high-level video shot", () => {
		const project = createContentProject("C:/project");
		const commands = parseContentAgentOperations(project, [
			{ type: "add_node", id: "topic", kind: "prompt", prompt: "A red sneaker in a night city" },
			{ type: "add_node", id: "opening", kind: "image-generator", aspectRatio: "16:9" },
			{ type: "add_node", id: "video", kind: "video-generator", aspectRatio: "16:9" },
			{
				type: "connect_nodes",
				edgeId: "topic-to-video",
				sourceNodeId: "topic",
				targetNodeId: "video",
				targetInput: "promptSources",
			},
			{
				type: "connect_nodes",
				edgeId: "opening-to-video",
				sourceNodeId: "opening",
				targetNodeId: "video",
				targetInput: "referenceImages",
			},
			{
				type: "configure_video_shot",
				targetNodeId: "video",
				strategy: "automatic",
				aspectRatio: "16:9",
				controlRequirements: { exactOpening: true, exactEnding: false },
				sources: [{ sourceNodeId: "opening" }],
				promptPlan: createVideoPromptPlan(),
			},
		], [FRAME_VIDEO_MODEL]);

		const next = applyContentProjectCommands(project, commands);
		const video = next.graph.nodes.find((node) => node.id === "video");
		expect(next.graph.edges.filter((edge) => edge.target === "video")).toEqual(expect.arrayContaining([
			expect.objectContaining({ source: "topic", targetHandle: "prompt" }),
			expect.objectContaining({ source: "opening", role: "firstFrame" }),
		]));
		expect(next.graph.edges.filter((edge) => edge.source === "opening" && edge.target === "video")).toHaveLength(1);
		expect(video?.data.promptDocument?.segments).toEqual(expect.arrayContaining([
			{ type: "prompt-reference", sourceNodeId: "topic" },
		]));
		expect(resolveContentPrompt(listConnectedPromptSources(next, "video"), video?.data ?? {})).toContain(
			"A red sneaker in a night city",
		);
		expect(resolveContentPrompt(listConnectedPromptSources(next, "video"), video?.data ?? {})).toContain(
			"Primary action:",
		);
	});

	it("numbers attached assets before generated references to match runtime input order", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{
				type: "asset.add",
				asset: { id: "scene-image", kind: "image", name: "scene", mimeType: "image/png", createdAt: "now" },
			},
			{
				type: "node.add",
				node: {
					id: "scene-assets",
					kind: "asset",
					position: { x: 0, y: 0 },
					data: { assetIds: ["scene-image"] },
				},
			},
			{ type: "node.add", node: { id: "person", kind: "image-generator", position: { x: 0, y: 300 } } },
			{ type: "node.add", node: { id: "video", kind: "video-generator", position: { x: 400, y: 0 } } },
		]);
		const commands = parseContentAgentOperations(project, [{
			type: "configure_video_shot",
			targetNodeId: "video",
			strategy: "omni-reference",
			aspectRatio: "16:9",
			controlRequirements: { requiresSceneReference: true },
			promptPlan: createVideoPromptPlan(),
			sources: [
				{ sourceNodeId: "person", alias: "actor", semanticRole: "identity", instruction: "Preserve identity" },
				{
					sourceNodeId: "scene-assets",
					assetIds: ["scene-image"],
					alias: "ballroom",
					semanticRole: "environment",
					instruction: "Use the room layout",
				},
			],
		}], [FRAME_VIDEO_MODEL]);

		const next = applyContentProjectCommands(project, commands);
		const prompt = next.graph.nodes.find((node) => node.id === "video")?.data.prompt;
		expect(prompt).toContain("<Picture 1>: ballroom (environment). Use the room layout.");
		expect(prompt).toContain("<Picture 2>: actor (identity). Preserve identity.");
	});

	it("requires one explicit fixed aspect ratio for omni-reference generation", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "person", kind: "image-generator", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "scene", kind: "image-generator", position: { x: 0, y: 300 } } },
			{ type: "node.add", node: { id: "video", kind: "video-generator", position: { x: 400, y: 0 } } },
		]);

		expect(() => parseContentAgentOperations(project, [{
			type: "configure_video_shot",
			targetNodeId: "video",
			strategy: "omni-reference",
			promptPlan: createVideoPromptPlan(),
			sources: [
				{ sourceNodeId: "person", alias: "person", semanticRole: "identity", instruction: "Preserve identity" },
				{ sourceNodeId: "scene", alias: "scene", semanticRole: "environment", instruction: "Use the scene" },
			],
		}], [FRAME_VIDEO_MODEL])).toThrowError(expect.objectContaining({ code: "video-shot-aspect-ratio-required" }));
	});

	it("requires two keyframe plans when exactEnding requests a hard last-frame anchor", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "opening", kind: "image-generator", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "video", kind: "video-generator", position: { x: 400, y: 0 } } },
		]);

		expect(() => parseContentAgentOperations(project, [{
			type: "configure_video_shot",
			targetNodeId: "video",
			aspectRatio: "16:9",
			controlRequirements: { exactEnding: true },
			sources: [{ sourceNodeId: "opening" }],
			promptPlan: createVideoPromptPlan(),
		}], [FRAME_VIDEO_MODEL])).toThrowError(expect.objectContaining({
			code: "video-shot-keyframes-required",
			details: { required: ["keyframes.first", "keyframes.last"] },
		}));
	});

	it("turns raw video media connections into an actionable high-level generation-plan error", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "image", kind: "image-generator", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "video", kind: "video-generator", position: { x: 400, y: 0 } } },
		]);

		try {
			parseContentAgentOperations(project, [
				{ type: "connect_nodes", source: "image", target: "video", targetInput: "startImages" },
			]);
			expect.unreachable("expected semantic connection error");
		} catch (error) {
			expect(error).toMatchObject({
				code: "generation-semantic-connection-required",
				retryable: true,
				details: {
					targetNodeId: "video",
					requiredOperation: "configure_video_shot",
					suggestedSource: { sourceNodeId: "image" },
					suggestedOperation: expect.objectContaining({
						type: "configure_video_shot",
						targetNodeId: "video",
					}),
				},
			});
		}
	});

	it("explains when configure_generation uses a source image as its target", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "product-image", kind: "image-generator", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "product-video", kind: "video-generator", position: { x: 400, y: 0 } } },
		]);

		try {
			parseContentAgentOperations(project, [
				{
					type: "configure_generation",
					targetNodeId: "product-image",
					generationIntent: "animate-still",
					sources: [{ sourceNodeId: "product-image" }],
				},
			], [FRAME_VIDEO_MODEL]);
			expect.unreachable("expected invalid generation target error");
		} catch (error) {
			expect(error).toMatchObject({
				code: "generation-intent-target-invalid",
				retryable: true,
				details: {
					targetNodeId: "product-image",
					targetKind: "image-generator",
					videoGeneratorNodeIds: ["product-video"],
					suggestedSource: { sourceNodeId: "product-image" },
				},
			});
		}
	});

	it("keeps the unambiguous generated-image reference role explicit", () => {
		const project = applyContentProjectCommands(createContentProject("C:/project"), [
			{ type: "node.add", node: { id: "source", kind: "image-generator", position: { x: 0, y: 0 } } },
			{ type: "node.add", node: { id: "target", kind: "image-generator", position: { x: 400, y: 0 } } },
		]);

		const commands = parseContentAgentOperations(project, [
			{ type: "connect_nodes", source: "source", target: "target", targetInput: "referenceImages" },
		]);

		expect(commands).toEqual([
			expect.objectContaining({ type: "edge.connect", targetHandle: "reference", role: "referenceImages" }),
		]);
	});

	it("rejects operations outside the agent workflow surface", () => {
		const project = createContentProject("C:/project");
		expect(CONTENT_AGENT_OPERATION_TYPES).not.toContain("add_timeline_clip");
		expect(() =>
			parseContentAgentOperations(project, [
				{ type: "add_timeline_clip", nodeId: "source", start: 0, duration: 5 },
			]),
		).toThrow("unsupported operation type: add_timeline_clip");
	});
});

function createKeyframePlan(phase: "first" | "last") {
	return {
		kind: "image-keyframe",
		phase,
		sceneFunction: `${phase} frame for one continuous dance shot`,
		referenceRole: "Preserve dancer identities and ballroom layout",
		protectedInvariants: ["same dancers", "same costumes", "same ballroom"],
		visibleState: phase === "first" ? "The dancers begin far apart" : "The dancers meet at center frame",
		composition: {
			framing: "Wide full-body two-shot",
			angle: "Eye-level",
			placement: phase === "first" ? "one dancer on each side" : "both dancers centered",
			cameraAxis: "Facing the stage along the center aisle",
		},
		environment: "Warm ballroom with a polished floor",
		lighting: { setup: "Soft evening key", direction: "From camera left" },
		style: "Natural cinematic photography",
		constraints: ["frozen readable pose", "no motion blur"],
	};
}

function createVideoPromptPlan() {
	return {
		kind: "video-shot",
		sceneFunction: "One continuous dance encounter",
		referenceRole: "References define dancer identity, costume and ballroom layout",
		protectedInvariants: ["same dancers", "same costumes", "same ballroom"],
		initialState: "Dancer A begins on the left while dancer B waits in the distance",
		primaryAction: "Dancer A crosses the floor with a flowing waltz and meets dancer B at center",
		secondaryMotion: "Costume fabric and chandelier reflections respond naturally to the movement",
		camera: {
			framing: "Wide full-body two-shot",
			movement: "a restrained tracking move",
			direction: "from left toward center stage",
			speed: "matching the dancers with a gentle ease-out",
			motivation: "keeping both faces and the meeting gesture readable",
			restPoint: "a balanced centered two-shot",
		},
		lighting: {
			setup: "Warm ballroom practicals with a soft side key",
			behavior: "Exposure and light direction remain stable throughout the move",
		},
		finalState: "Both dancers meet at center frame and hold eye contact",
		constraints: ["one continuous shot", "no identity drift", "no scene change"],
	};
}
