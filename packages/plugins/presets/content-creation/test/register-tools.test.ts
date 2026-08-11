import { validateToolArguments, type Tool } from "@vetta/ai";
import type { PluginAgentToolRegistration, PluginContext } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseContentAgentOperations } from "../src/agent/operations";
import type { ContentCreationAgentService } from "../src/agent/service";
import { createContentCreationAgentState } from "../src/agent/state";
import { ContentGenerationIntentError } from "../src/generation/generation-intent";
import type { ContentModelDescriptor } from "../src/generation/types";
import { applyContentProjectCommands } from "../src/project/commands";
import { createContentProject } from "../src/project/types";
import { ContentRunApprovalStore } from "../src/plugin/run-approval";
import {
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
		registerContentCreationTools(ctx, agent, runApprovals);
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

	it("registers only the three domain tools", () => {
		expect([...registered.keys()]).toEqual([
			CONTENT_INSPECT_TOOL_NAME,
			CONTENT_EDIT_TOOL_NAME,
			CONTENT_RUN_TOOL_NAME,
		]);
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
				{ type: "connect_nodes", source: "product-image", target: "product-video", targetInput: "startImages" },
				{ type: "connect_nodes", source: "product-video", target: "output", targetInput: "content" },
			],
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

	it("runs a real validated product-image-to-video batch through the tool handler", async () => {
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
				{ type: "add_node", id: "product-video", kind: "video-generator", prompt: "Slow cinematic camera move" },
				{ type: "add_node", id: "output", kind: "output" },
				{ type: "connect_nodes", source: "prompt", target: "product-image", targetInput: "prompt" },
				{ type: "connect_nodes", source: "product-video", target: "output", targetInput: "content" },
				{
					type: "configure_generation",
					targetNodeId: "product-video",
					generationIntent: "animate-still",
					sources: [{ sourceNodeId: "product-image" }],
				},
			],
		};
		const validated = validateRegisteredTool(CONTENT_EDIT_TOOL_NAME, input);

		const result = await tool<typeof input>(CONTENT_EDIT_TOOL_NAME).handler(toolContext(validated as typeof input));

		expect(result).toMatchObject({ ok: true, status: "applied", revision: 1, nodeCount: 4, connectionCount: 3 });
		expect(project.graph.edges).toEqual(expect.arrayContaining([
			expect.objectContaining({ source: "product-image", target: "product-video", role: "firstFrame" }),
			expect.objectContaining({ source: "product-video", target: "output", targetHandle: "content" }),
		]));
		expect(project.graph.nodes.find((node) => node.id === "product-video")?.data).toMatchObject({
			providerId: "test",
			modelId: "frame-video",
			modeId: "image-to-video",
		});
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
