import { validateToolArguments, type Tool } from "@vetta/ai";
import type { PluginAgentToolRegistration, PluginContext } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentGenerationPromptPlanError } from "../src/agent/generation-prompt-plan";
import { parseContentAgentOperations } from "../src/agent/operations";
import type { ContentCreationAgentService } from "../src/agent/service";
import { createContentCreationAgentState } from "../src/agent/state";
import { ContentVideoShotPlanError } from "../src/agent/video-shot-plan";
import { ContentGenerationIntentError } from "../src/generation/generation-intent";
import { ContentLocalAssetError, type ContentLocalAssetService } from "../src/generation/local-asset-service";
import type { ContentModelDescriptor } from "../src/generation/types";
import { listConnectedPromptSources, resolveContentPrompt } from "../src/node/prompt-sources";
import { applyContentProjectCommands } from "../src/project/commands";
import { createContentProject } from "../src/project/types";
import { ContentRunApprovalStore } from "../src/plugin/run-approval";
import {
	CONTENT_ASSETS_TOOL_NAME,
	CONTENT_EDIT_TOOL_NAME,
	CONTENT_INSPECT_TOOL_NAME,
	CONTENT_RUN_TOOL_NAME,
	registerContentCreationTools,
} from "../src/plugin/register-tools";

const TOOL_TEST_MODELS: readonly ContentModelDescriptor[] = [
	{
		providerId: "test",
		modelId: "image",
		displayName: "Image",
		outputKind: "image",
		aspectRatios: ["1:1"],
		modes: [{ id: "text-to-image", inputs: [] }],
	},
	{
		providerId: "test",
		modelId: "frame-video",
		displayName: "Frame video",
		outputKind: "video",
		aspectRatios: ["16:9"],
		modes: [{
			id: "image-to-video",
			inputs: [{ id: "firstFrame", accepts: ["image"], minItems: 1, maxItems: 1 }],
		}],
	},
];

function toolContext<TInput>(input: TInput) {
	return {
		session: { id: "session", cwd: "C:/project" },
		trigger: { input },
	} as unknown as Parameters<PluginAgentToolRegistration<TInput>["handler"]>[0];
}

describe("content creation tool registration", () => {
	const registered = new Map<string, PluginAgentToolRegistration<unknown>>();
	const openActivityTab = vi.fn();
	const edit = vi.fn(async (_cwd: string, _operations: readonly unknown[], _expectedRevision?: number) => ({
		projectId: "project",
		revision: 2,
		graph: { nodes: [{ id: "prompt" }, { id: "image" }], edges: [{ id: "edge" }] },
	}));
	const inspect = vi.fn(async (_cwd: string) => ({ analysis: { status: "ready", connections: [{ id: "edge" }] } }));
	const prepareRun = vi.fn(async () => ({
		id: "run",
		cwd: "C:/project",
		projectId: "project",
		expectedRevision: 2,
		nodeIds: ["image"],
		status: "awaiting-confirmation",
		completedNodeIds: [],
		failedNodeIds: [],
		skippedNodeIds: [],
	}));
	const agent = { edit, inspect, prepareRun } as unknown as ContentCreationAgentService;
	const listLocalAssets = vi.fn(async () => [
		{ path: "C:/media/hero.png", name: "hero.png", size: 5, kind: "image" as const, mimeType: "image/png" },
	]);
	const importLocalAssets = vi.fn(async () => ({
		project: { projectId: "project", revision: 1 },
		assetNodeId: "assets",
		assets: [{ id: "hero", name: "hero.png", kind: "image", mimeType: "image/png" }],
	}));
	const localAssets = {
		list: listLocalAssets,
		import: importLocalAssets,
	} as unknown as ContentLocalAssetService;
	const runApprovals = new ContentRunApprovalStore();
	const ctx = {
		agent: {
			registerTool: (tool: PluginAgentToolRegistration<unknown>) => {
				if (!tool.name) throw new Error("registered tool name is required");
				registered.set(tool.name, tool);
				return { dispose() {} };
			},
		},
		ui: { openActivityTab },
	} as unknown as PluginContext;

	beforeEach(() => {
		registered.clear();
		vi.clearAllMocks();
		runApprovals.clear();
		registerContentCreationTools(ctx, agent, runApprovals, localAssets);
	});

	function tool<TInput>(name: string): PluginAgentToolRegistration<TInput> {
		const registration = registered.get(name);
		if (!registration) throw new Error(`tool was not registered: ${name}`);
		return registration as PluginAgentToolRegistration<TInput>;
	}

	function validateRegisteredTool(name: string, input: Record<string, unknown>) {
		const registration = tool<Record<string, unknown>>(name);
		return validateToolArguments(
			{
				name,
				description: registration.description ?? "",
				parameters: registration.parameters,
			} as Tool,
			{ type: "toolCall", id: "call", name, arguments: input },
		);
	}

	it("registers the four domain tools", () => {
		expect([...registered.keys()]).toEqual([
			CONTENT_INSPECT_TOOL_NAME,
			CONTENT_ASSETS_TOOL_NAME,
			CONTENT_EDIT_TOOL_NAME,
			CONTENT_RUN_TOOL_NAME,
		]);
	});

	it("edit 在注册处声明 heavy，其余工具缺省 light", () => {
		// edit 往用户工作区写内容工程文件树；run 自带全局确认对话框、assets 落插件托管存储、
		// inspect 只读，均不该再进首调确认闸。
		expect(tool(CONTENT_EDIT_TOOL_NAME).side_effect).toBe("heavy");
		expect(tool(CONTENT_RUN_TOOL_NAME).side_effect).toBeUndefined();
		expect(tool(CONTENT_ASSETS_TOOL_NAME).side_effect).toBeUndefined();
		expect(tool(CONTENT_INSPECT_TOOL_NAME).side_effect).toBeUndefined();
	});

	it("validates and imports local media without returning file bytes", async () => {
		const input = validateRegisteredTool(CONTENT_ASSETS_TOOL_NAME, {
			action: "import",
			paths: ["C:/media/hero.png"],
			expectedRevision: 0,
			assetNodeId: "existing-assets",
		});

		const result = await tool<Record<string, unknown>>(CONTENT_ASSETS_TOOL_NAME).handler(
			toolContext(input as Record<string, unknown>),
		);

		expect(importLocalAssets).toHaveBeenCalledWith(expect.objectContaining({
			projectDir: "C:/project",
			paths: ["C:/media/hero.png"],
			expectedRevision: 0,
			targetNodeId: "existing-assets",
		}));
			expect(result).toMatchObject({
			ok: true,
			status: "imported",
			assetNodeId: "assets",
			generationSource: { sourceNodeId: "assets", assetIds: ["hero"] },
			generationSources: [{ sourceNodeId: "assets", assetIds: ["hero"], kind: "image" }],
		});
		expect(JSON.stringify(result)).not.toContain("aW1hZ2U=");
	});

	it("returns actionable directory-selection errors", async () => {
		importLocalAssets.mockRejectedValueOnce(new ContentLocalAssetError(
			"select explicit paths",
			"local-media-selection-required",
			{ candidates: [{ path: "C:/media/hero.png", name: "hero.png" }] },
		));

		const result = await tool<{ action: "import"; paths: string[] }>(CONTENT_ASSETS_TOOL_NAME).handler(
			toolContext({ action: "import", paths: ["C:/media"] }),
		);

		expect(result).toMatchObject({
			ok: false,
			retryable: true,
			code: "local-media-selection-required",
			details: { candidates: [expect.objectContaining({ name: "hero.png" })] },
		});
	});

	it("applies edits without returning a conversation card", async () => {
		const result = await tool<{ operations: unknown[]; expectedRevision?: number }>(CONTENT_EDIT_TOOL_NAME).handler(
			toolContext({ operations: [{ type: "add_node", kind: "prompt" }], expectedRevision: 1 }),
		);

		expect(edit).toHaveBeenCalledWith("C:/project", [{ type: "add_node", kind: "prompt" }], 1);
		expect(result).toMatchObject({ ok: true, status: "applied", revision: 2, connectionCount: 1 });
		expect(result).not.toHaveProperty("cards");
	});

	it("accepts legacy targetInput strings through the actual host AJV validation path", () => {
		expect(() => validateRegisteredTool(CONTENT_EDIT_TOOL_NAME, {
			expectedRevision: 0,
			projectDir: "C:/project",
			operations: [
				{
					type: "connect_nodes",
					sourceNodeId: "product-image",
					targetNodeId: "product-video",
					targetInput: "startImages",
				},
				{
					type: "connect_nodes",
					sourceNodeId: "product-video",
					targetNodeId: "output",
					targetInput: "content",
				},
			],
		})).not.toThrow();
	});

	it("accepts canonical connection ids through the actual host AJV validation path", () => {
		expect(() => validateRegisteredTool(CONTENT_EDIT_TOOL_NAME, {
			operations: [{
				type: "connect_nodes",
				edgeId: "prompt-to-image",
				sourceNodeId: "prompt",
				targetNodeId: "image",
				targetInput: "promptSources",
			}],
		})).not.toThrow();
	});

	it("rejects low-level source roles on high-level video shots during schema validation", () => {
		expect(() => validateRegisteredTool(CONTENT_EDIT_TOOL_NAME, {
			operations: [{
				type: "configure_video_shot",
				targetNodeId: "video",
				promptPlan: createVideoPromptPlan(),
				sources: [{ sourceNodeId: "image", role: "referenceImages" }],
			}],
		})).toThrow();
	});

	it("requires operation-specific fields during host schema validation", () => {
		expect(() => validateRegisteredTool(CONTENT_EDIT_TOOL_NAME, {
			operations: [{ type: "connect_nodes", sourceNodeId: "prompt" }],
		})).toThrow();
		expect(() => validateRegisteredTool(CONTENT_EDIT_TOOL_NAME, {
			operations: [{ type: "configure_video_shot", targetNodeId: "video" }],
		})).toThrow();
	});

	it("keeps exact-ending semantics in the domain validator instead of provider-fragile schema conditionals", () => {
		expect(() => validateRegisteredTool(CONTENT_EDIT_TOOL_NAME, {
			operations: [{
				type: "configure_video_shot",
				targetNodeId: "video",
				controlRequirements: { exactEnding: true },
				promptPlan: createVideoPromptPlan(),
				sources: [{ sourceNodeId: "opening" }],
			}],
		})).not.toThrow();
		expect(() => validateRegisteredTool(CONTENT_EDIT_TOOL_NAME, {
			operations: [{
				type: "configure_video_shot",
				targetNodeId: "video",
				controlRequirements: { exactEnding: false },
				promptPlan: createVideoPromptPlan(),
				sources: [{ sourceNodeId: "opening" }],
			}],
		})).not.toThrow();
	});

	it("accepts a structured omni-reference video shot through host AJV validation", () => {
		expect(() => validateRegisteredTool(CONTENT_EDIT_TOOL_NAME, {
			operations: [{
				type: "configure_video_shot",
				targetNodeId: "video",
				strategy: "automatic",
				controlRequirements: { requiresSceneReference: true },
				promptPlan: createVideoPromptPlan(),
				sources: [
					{
						sourceNodeId: "person",
						alias: "dancer",
						semanticRole: "identity",
						instruction: "Preserve face and costume",
					},
					{
						sourceNodeId: "scene",
						alias: "ballroom",
						semanticRole: "environment",
						instruction: "Use the room layout and lighting",
					},
				],
			}],
		})).not.toThrow();
	});

	it("returns retryable corrective context for semantic generation mistakes", async () => {
		edit.mockRejectedValueOnce(new ContentGenerationIntentError(
			"configure_generation targetNodeId must identify the receiving video-generator",
			"generation-intent-target-invalid",
			{ targetNodeId: "product-image", videoGeneratorNodeIds: ["product-video"] },
		));

		const result = await tool<{ operations: unknown[] }>(CONTENT_EDIT_TOOL_NAME).handler(
			toolContext({
				operations: [{
					type: "configure_generation",
					targetNodeId: "product-image",
					generationIntent: "animate-still",
					sources: [{ sourceNodeId: "product-image" }],
				}],
			}),
		);

		expect(result).toMatchObject({
			ok: false,
			retryable: true,
			code: "generation-intent-target-invalid",
			details: { targetNodeId: "product-image", videoGeneratorNodeIds: ["product-video"] },
		});
	});

	it("returns structured corrective context for an incomplete Agent video prompt", async () => {
		edit.mockRejectedValueOnce(new ContentGenerationPromptPlanError(
			"Agent-authored video prompt does not satisfy the production method",
			"video-prompt-method-incomplete",
			{ nodeId: "product-video", issues: ["reference-role-missing"], recommendedOperationField: "promptPlan" },
		));

		const result = await tool<{ operations: unknown[] }>(CONTENT_EDIT_TOOL_NAME).handler(
			toolContext({ operations: [{ type: "update_node", nodeId: "product-video", prompt: "Slow push-in" }] }),
		);

		expect(result).toMatchObject({
			ok: false,
			retryable: true,
			code: "video-prompt-method-incomplete",
			details: {
				nodeId: "product-video",
				issues: ["reference-role-missing"],
				recommendedOperationField: "promptPlan",
			},
		});
	});

	it("returns strategy conflicts as retryable structured tool errors", async () => {
		edit.mockRejectedValueOnce(new ContentVideoShotPlanError(
			"animate-still cannot satisfy an exact final-frame requirement",
			"video-shot-strategy-conflict",
			{ requestedStrategy: "animate-still", recommendedStrategy: "first-last-frame" },
		));

		const result = await tool<{ operations: unknown[] }>(CONTENT_EDIT_TOOL_NAME).handler(
			toolContext({ operations: [{ type: "configure_video_shot", targetNodeId: "video" }] }),
		);

		expect(result).toMatchObject({
			ok: false,
			retryable: true,
			code: "video-shot-strategy-conflict",
			details: { requestedStrategy: "animate-still", recommendedStrategy: "first-last-frame" },
		});
	});

	it("runs a real validated high-level image-to-video batch through the tool handler", async () => {
		let project = createContentProject("C:/project");
		edit.mockImplementationOnce(async (_cwd, operations) => {
			project = applyContentProjectCommands(
				project,
				parseContentAgentOperations(project, operations, TOOL_TEST_MODELS),
			);
			return project;
		});
		inspect.mockImplementationOnce(async () => createContentCreationAgentState(project, TOOL_TEST_MODELS));
		const input = {
			expectedRevision: 0,
			operations: [
				{
					type: "update_workflow",
					title: "Product ad",
					objective: "Animate the product hero image",
					deliverables: [{ type: "video", fromNode: "output", description: "Final ad" }],
				},
				{ type: "add_node", id: "prompt", kind: "prompt", prompt: "Premium product lighting" },
				{ type: "add_node", id: "product-image", kind: "image-generator", prompt: "Product hero image" },
				{
					type: "add_node",
					id: "product-video",
					kind: "video-generator",
					duration: 5,
					aspectRatio: "16:9",
				},
				{ type: "add_node", id: "output", kind: "output" },
				{
					type: "connect_nodes",
					sourceNodeId: "prompt",
					targetNodeId: "product-image",
					targetInput: "prompt",
				},
				{
					type: "connect_nodes",
					sourceNodeId: "prompt",
					targetNodeId: "product-video",
					targetInput: "promptSources",
				},
				{
					type: "connect_nodes",
					sourceNodeId: "product-image",
					targetNodeId: "product-video",
					targetInput: "referenceImages",
				},
				{
					type: "connect_nodes",
					sourceNodeId: "product-video",
					targetNodeId: "output",
					targetInput: "content",
				},
				{
					type: "configure_video_shot",
					targetNodeId: "product-video",
					strategy: "automatic",
					aspectRatio: "16:9",
					controlRequirements: { exactOpening: true, exactEnding: false },
					sources: [{ sourceNodeId: "product-image" }],
					promptPlan: createVideoPromptPlan(),
				},
			],
		};
		const validated = validateRegisteredTool(CONTENT_EDIT_TOOL_NAME, input);

		const result = await tool<typeof input>(CONTENT_EDIT_TOOL_NAME).handler(toolContext(validated as typeof input));

		expect(result).toMatchObject({ ok: true, status: "applied", revision: 1, nodeCount: 4, connectionCount: 4 });
		expect(project.graph.edges).toEqual(expect.arrayContaining([
			expect.objectContaining({ source: "product-image", target: "product-video", role: "firstFrame" }),
			expect.objectContaining({ source: "product-video", target: "output", targetHandle: "content" }),
		]));
		expect(project.graph.nodes.find((node) => node.id === "product-video")?.data).toMatchObject({
			providerId: "test",
			modelId: "frame-video",
			modeId: "image-to-video",
		});
		const video = project.graph.nodes.find((node) => node.id === "product-video");
		const effectivePrompt = resolveContentPrompt(listConnectedPromptSources(project, "product-video"), video?.data ?? {});
		expect(effectivePrompt).toContain("Premium product lighting");
		expect(effectivePrompt).toContain("Primary action:");
	});

	it("queues prepared generation for the global dialog without returning a card", async () => {
		const result = await tool<{ action: "prepare" }>(CONTENT_RUN_TOOL_NAME).handler(
			toolContext({ action: "prepare" }),
		);

		expect(result).toMatchObject({ ok: true, status: "awaiting-confirmation", run: { id: "run" } });
		expect(result).not.toHaveProperty("cards");
		expect(runApprovals.getSnapshot()).toEqual(["run"]);
	});
});

function createVideoPromptPlan() {
	return {
		kind: "video-shot",
		sceneFunction: "Premium product reveal for a social advertisement",
		referenceRole: "Use the product image as the identity and initial composition reference",
		protectedInvariants: ["Preserve product geometry", "Preserve branding and color"],
		initialState: "The product is centered and motionless on a dark studio surface",
		primaryAction: "A controlled highlight travels across the product face",
		secondaryMotion: "Fine atmospheric particles drift behind the product",
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
			behavior: "Specular highlights stay controlled and never clip",
		},
		finalState: "Hold the recognizable product in a clean hero frame for the final second",
		constraints: ["No text overlays", "No product redesign"],
	};
}
