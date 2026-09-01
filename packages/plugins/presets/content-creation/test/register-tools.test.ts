import { validateToolArguments, type Tool } from "@vetta/ai";
import type { PluginAgentToolRegistration, PluginContext } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContentGenerationPromptPlanError } from "../src/agent/generation-prompt-plan";
import { parseContentAgentOperations } from "../src/agent/operations";
import type { ContentCreationAgentService } from "../src/agent/service";
import { createContentCreationAgentState } from "../src/agent/state";
import { ContentGenerationIntentError } from "../src/generation/generation-intent";
import { ContentLocalAssetError, type ContentLocalAssetService } from "../src/generation/local-asset-service";
import type { ContentModelDescriptor } from "../src/generation/types";
import { applyContentProjectCommands } from "../src/project/commands";
import { createContentProject } from "../src/project/types";
import { ContentRunApprovalStore } from "../src/plugin/run-approval";
import {
	CONTENT_EXECUTE_TOOL_NAME,
	CONTENT_SEARCH_TOOL_NAME,
	registerContentCreationTools,
} from "../src/plugin/tools";
import { validateContentOperationInput } from "../src/plugin/tools/execute";
import { CONTENT_SEARCH_RESULT_CHARACTER_BUDGET } from "../src/plugin/tools/search";

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

describe("content creation progressive tool surface", () => {
	const registered = new Map<string, PluginAgentToolRegistration<unknown>>();
	const openActivityTab = vi.fn();
	const edit = vi.fn(async (_cwd: string, _operations: readonly unknown[], _expectedRevision?: number) => ({
		projectId: "project",
		revision: 2,
		graph: { nodes: [{ id: "prompt" }, { id: "image" }], edges: [{ id: "edge" }] },
	}));
	const inspect = vi.fn<ContentCreationAgentService["inspect"]>(async (_cwd: string) => ({
		format: "vetta.content-creation/project",
		schemaVersion: 6,
		projectId: "project",
		revision: 2,
		workflow: { title: "Project", objective: "Create", deliverables: [] },
		nodes: [],
		assets: [],
		runtime: { jobs: [] },
		capabilities: { models: [] },
		diagnostics: [],
		analysis: { status: "ready", connections: [{ id: "edge" }], components: [], orphanNodeIds: [] },
	}) as unknown as Awaited<ReturnType<ContentCreationAgentService["inspect"]>>);
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
	const localAssets = { list: listLocalAssets, import: importLocalAssets } as unknown as ContentLocalAssetService;
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

	async function search(input: { query?: string; operations?: string[]; limit?: number }) {
		return tool<typeof input>(CONTENT_SEARCH_TOOL_NAME).handler(toolContext(input)) as Promise<{
			mode: string;
			operations: Array<{
				id: string;
				executeOperation: string;
				inputPlacement: string;
				inputSchema?: object;
			}>;
			unknownOperations?: string[];
			omittedOperations?: string[];
		}>;
	}

	async function execute(operation: "inspect" | "assets" | "edit" | "run", input: Record<string, unknown>) {
		return tool<{ operation: typeof operation; input: Record<string, unknown> }>(CONTENT_EXECUTE_TOOL_NAME).handler(
			toolContext({ operation, input }),
		);
	}

	it("registers a fixed search and execute surface", () => {
		expect([...registered.keys()]).toEqual([CONTENT_SEARCH_TOOL_NAME, CONTENT_EXECUTE_TOOL_NAME]);
		for (const registration of registered.values()) {
			expect(registration.scope_use).toEqual(["conversation", "project"]);
			expect(registration).not.toHaveProperty("side_effect");
		}
	});

	it("keeps the always-loaded model surface below a fixed context budget", () => {
		const modelSurface = [...registered.values()].map(({ name, description, parameters }) => ({
			name,
			description,
			parameters,
		}));
		const serialized = JSON.stringify(modelSurface);
		expect(serialized.length).toBeLessThan(4_000);
		expect(serialized).not.toContain("configure_video_shot");
		expect(serialized).not.toContain("first-last-frame-plan");
	});

	it("returns a compact index without eagerly returning operation schemas", async () => {
		const result = await search({});
		expect(result.mode).toBe("index");
		expect(result.operations.map((entry) => entry.id)).toEqual(expect.arrayContaining([
			"inspect",
			"assets",
			"edit.add_node",
			"edit.configure_video_shot",
			"run",
		]));
		expect(result.operations.every((entry) => entry.inputSchema === undefined)).toBe(true);
	});

	it("loads only explicitly requested edit schemas", async () => {
		const result = await search({ operations: ["edit.add_node", "edit.connect_nodes", "missing"] });
		expect(result.operations.map((entry) => entry.id)).toEqual(["edit.add_node", "edit.connect_nodes"]);
		expect(result.operations.every((entry) => entry.inputPlacement === "input.operations[]")).toBe(true);
		expect(result.unknownOperations).toEqual(["missing"]);
		const serialized = JSON.stringify(result);
		expect(serialized).toContain('"const":"add_node"');
		expect(serialized).not.toContain("first-last-frame-plan");
	});

	it("discovers strategy-specific video contracts on demand", async () => {
		const result = await search({ operations: ["edit.configure_video_shot"] });
		const schema = JSON.stringify(result.operations[0]?.inputSchema);
		expect(schema).toContain("text-to-video-plan");
		expect(schema).toContain("animate-still-plan");
		expect(schema).toContain("first-last-frame-plan");
		expect(schema).toContain("omni-reference-plan");
		expect(schema).toContain("transform-video-plan");
		expect(schema).not.toContain('"const":"video-shot"');
	});

	it("bounds schema search results while always returning the first requested contract", async () => {
		const result = await search({ operations: [
			"edit.configure_video_shot",
			"edit.update_workflow",
			"edit.add_node",
			"edit.rename_node",
			"edit.set_node_purpose",
			"edit.update_node",
			"edit.duplicate_node",
			"edit.connect_nodes",
			"edit.bind_assets",
			"edit.configure_generation",
			"edit.delete_node",
			"edit.delete_edge",
		] });
		expect(result.operations[0]?.id).toBe("edit.configure_video_shot");
		expect(result.omittedOperations?.length).toBeGreaterThan(0);
		expect(JSON.stringify(result.operations).length).toBeLessThan(
			CONTENT_SEARCH_RESULT_CHARACTER_BUDGET + 1_000,
		);
	});

	it("ranks relevant operations for free-text discovery", async () => {
		const result = await search({ query: "configure video shot", limit: 1 });
		expect(result.operations[0]?.id).toBe("edit.configure_video_shot");
	});

	it("revalidates nested execute input inside the plugin boundary", async () => {
		const result = await execute("edit", {
			operations: [{ type: "connect_nodes", sourceNodeId: "prompt" }],
		});
		expect(result).toMatchObject({
			ok: false,
			retryable: true,
			code: "content-operation-input-invalid",
			details: { operation: "edit" },
		});
		expect(edit).not.toHaveBeenCalled();
	});

	it("accepts every valid edit operation variant at the nested validation boundary", () => {
		const operations = [
			{ type: "update_workflow", title: "Campaign" },
			{ type: "add_node", kind: "prompt" },
			{ type: "rename_node", nodeId: "node", name: "Hero" },
			{ type: "set_node_purpose", nodeId: "node", purpose: "Master image" },
			{ type: "update_node", nodeId: "node", prompt: "Premium lighting" },
			{ type: "duplicate_node", nodeId: "node" },
			{
				type: "bind_assets",
				sourceNodeId: "assets",
				targetNodeId: "image",
				assetIds: ["hero"],
				targetInput: "referenceImages",
			},
			{ type: "configure_generation", targetNodeId: "video", generationIntent: "text-to-video" },
			{
				type: "configure_video_shot",
				targetNodeId: "video",
				promptPlan: createVideoPromptPlan(),
				sources: [{ sourceNodeId: "image" }],
			},
			{ type: "delete_node", nodeId: "node" },
			{ type: "connect_nodes", sourceNodeId: "prompt", targetNodeId: "image" },
			{ type: "delete_edge", edgeId: "edge" },
		];
		expect(validateContentOperationInput("edit", { operations })).toBeUndefined();
	});

	it("returns schemas compatible with the host validator", async () => {
		const result = await search({ operations: ["edit.configure_video_shot"] });
		const schema = result.operations[0]?.inputSchema;
		expect(() => validateToolArguments(
			{ name: "edit.configure_video_shot", description: "", parameters: schema } as Tool,
			{
				type: "toolCall",
				id: "call",
				name: "edit.configure_video_shot",
				arguments: {
					type: "configure_video_shot",
					targetNodeId: "video",
					promptPlan: createVideoPromptPlan(),
					sources: [{ sourceNodeId: "image", role: "referenceImages" }],
				},
			},
		)).toThrow();
	});

	it("inspects the narrow requested projection", async () => {
		const result = await execute("inspect", { view: "readiness" });
		expect(inspect).toHaveBeenCalledWith("C:/project");
		expect(result).toMatchObject({ projectId: "project", revision: 2, analysis: { status: "ready" } });
	});

	it("imports local media without returning file bytes", async () => {
		const result = await execute("assets", {
			action: "import",
			paths: ["C:/media/hero.png"],
			expectedRevision: 0,
			assetNodeId: "existing-assets",
		});
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
		});
		expect(JSON.stringify(result)).not.toContain("aW1hZ2U=");
	});

	it("returns actionable directory-selection errors", async () => {
		importLocalAssets.mockRejectedValueOnce(new ContentLocalAssetError(
			"select explicit paths",
			"local-media-selection-required",
			{ candidates: [{ path: "C:/media/hero.png", name: "hero.png" }] },
		));
		const result = await execute("assets", { action: "import", paths: ["C:/media"] });
		expect(result).toMatchObject({
			ok: false,
			retryable: true,
			code: "local-media-selection-required",
			details: { candidates: [expect.objectContaining({ name: "hero.png" })] },
		});
	});

	it("applies revision-bound edits without returning a conversation card", async () => {
		const result = await execute("edit", {
			operations: [{ type: "add_node", kind: "prompt" }],
			expectedRevision: 1,
		});
		expect(edit).toHaveBeenCalledWith("C:/project", [{ type: "add_node", kind: "prompt" }], 1);
		expect(result).toMatchObject({ ok: true, status: "applied", revision: 2, connectionCount: 1 });
		expect(result).not.toHaveProperty("cards");
	});

	it("preserves structured corrective context from the domain service", async () => {
		edit.mockRejectedValueOnce(new ContentGenerationIntentError(
			"configure_generation targetNodeId must identify the receiving video-generator",
			"generation-intent-target-invalid",
			{ targetNodeId: "product-image", videoGeneratorNodeIds: ["product-video"] },
		));
		const result = await execute("edit", {
			operations: [{
				type: "configure_generation",
				targetNodeId: "product-image",
				generationIntent: "animate-still",
				sources: [{ sourceNodeId: "product-image" }],
			}],
		});
		expect(result).toMatchObject({
			ok: false,
			retryable: true,
			code: "generation-intent-target-invalid",
			details: { targetNodeId: "product-image", videoGeneratorNodeIds: ["product-video"] },
		});
	});

	it("preserves structured video prompt repair errors", async () => {
		edit.mockRejectedValueOnce(new ContentGenerationPromptPlanError(
			"Agent-authored video prompt does not satisfy the production method",
			"video-prompt-method-incomplete",
			{ nodeId: "product-video", issues: ["reference-role-missing"], recommendedOperationField: "promptPlan" },
		));
		const result = await execute("edit", {
			operations: [{ type: "update_node", nodeId: "product-video", prompt: "Slow push-in" }],
		});
		expect(result).toMatchObject({
			ok: false,
			code: "video-prompt-method-incomplete",
			details: { recommendedOperationField: "promptPlan" },
		});
	});

	it("runs a validated high-level image-to-video batch through the execute facade", async () => {
		let project = createContentProject("C:/project");
		edit.mockImplementationOnce(async (_cwd, operations) => {
			project = applyContentProjectCommands(
				project,
				parseContentAgentOperations(project, operations, TOOL_TEST_MODELS),
			);
			return project;
		});
		inspect.mockImplementationOnce(async () => createContentCreationAgentState(project, TOOL_TEST_MODELS));
		const result = await execute("edit", {
			expectedRevision: 0,
			operations: [
				{ type: "add_node", id: "prompt", kind: "prompt", prompt: "Premium product lighting" },
				{ type: "add_node", id: "product-image", kind: "image-generator", prompt: "Product hero image" },
				{ type: "add_node", id: "product-video", kind: "video-generator", duration: 5, aspectRatio: "16:9" },
				{ type: "add_node", id: "output", kind: "output" },
				{
					type: "connect_nodes",
					sourceNodeId: "prompt",
					targetNodeId: "product-video",
					targetInput: "promptSources",
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
		});
		expect(result).toMatchObject({ ok: true, status: "applied", revision: 1, nodeCount: 4 });
		expect(project.graph.edges).toEqual(expect.arrayContaining([
			expect.objectContaining({ source: "product-image", target: "product-video", role: "firstFrame" }),
			expect.objectContaining({ source: "product-video", target: "output", targetHandle: "content" }),
		]));
	});

	it("queues prepared generation for the unchanged global approval boundary", async () => {
		const result = await execute("run", { action: "prepare" });
		expect(result).toMatchObject({ ok: true, status: "awaiting-confirmation", run: { id: "run" } });
		expect(result).not.toHaveProperty("cards");
		expect(runApprovals.getSnapshot()).toEqual(["run"]);
	});
});

function createVideoPromptPlan() {
	return {
		kind: "animate-still-plan",
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
		sourceImageContract: {
			authority: "The product image controls identity, geometry, materials, and opening composition",
			inherit: ["Product geometry", "Branding", "Studio composition"],
			animate: ["Camera push-in", "One controlled highlight"],
			introduce: ["Fine atmospheric particles"],
		},
	};
}
