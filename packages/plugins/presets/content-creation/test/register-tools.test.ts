import type { PluginAgentToolRegistration, PluginContext } from "@vetta-org/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentCreationAgentService } from "../src/agent/service";
import { ContentRunApprovalStore } from "../src/plugin/run-approval";
import {
	CONTENT_EDIT_TOOL_NAME,
	CONTENT_INSPECT_TOOL_NAME,
	CONTENT_RUN_TOOL_NAME,
	registerContentCreationTools,
} from "../src/plugin/register-tools";

function toolContext<TInput>(input: TInput) {
	return {
		session: { id: "session", cwd: "C:/project" },
		trigger: { input },
	} as unknown as Parameters<PluginAgentToolRegistration<TInput>["handler"]>[0];
}

describe("content creation tool registration", () => {
	const registered = new Map<string, PluginAgentToolRegistration<unknown>>();
	const openActivityTab = vi.fn();
	const edit = vi.fn(async () => ({
		projectId: "project",
		revision: 2,
		graph: { nodes: [{ id: "prompt" }, { id: "image" }], edges: [{ id: "edge" }] },
	}));
	const inspect = vi.fn(async () => ({ analysis: { status: "ready", connections: [{ id: "edge" }] } }));
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

	it("queues prepared generation for the global dialog without returning a card", async () => {
		const result = await tool<{ action: "prepare" }>(CONTENT_RUN_TOOL_NAME).handler(
			toolContext({ action: "prepare" }),
		);

		expect(result).toMatchObject({ ok: true, status: "awaiting-confirmation", run: { id: "run" } });
		expect(result).not.toHaveProperty("cards");
		expect(runApprovals.getSnapshot()).toEqual(["run"]);
	});
});
