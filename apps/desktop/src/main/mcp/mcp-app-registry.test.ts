import type {
	IMcpClient,
	McpGetTaskResult,
	McpInitializeResult,
	McpPromptsListResult,
	McpResourceReadResult,
	McpResourcesListResult,
	McpToolCallResult,
	McpToolsListResult,
} from "@vetta/runtime-mcp";
import { McpTaskCreatedError, McpTaskExecutionCoordinator } from "@vetta/runtime-mcp";
import { describe, expect, it } from "vitest";
import { DesktopMcpAppRegistry } from "./mcp-app-registry.js";

const APP_TOOL = {
	name: "dashboard",
	inputSchema: { type: "object" as const },
	_meta: { ui: { resourceUri: "ui://dashboard" } },
};

describe("DesktopMcpAppRegistry", () => {
	it("loads a profiled UI resource and exposes only an opaque attachment", async () => {
		const client = new FakeClient();
		const registry = new DesktopMcpAppRegistry({ createId: () => "mcp-app-surface-1" });
		const attachment = await registry.attach({
			client,
			acquireClient: () => ({ client, release: async () => undefined }),
			serverName: "demo",
			serverTools: [APP_TOOL],
			autoApproveTools: [],
			tool: APP_TOOL,
			input: {},
			result: { content: [{ type: "text", text: "done" }] },
			context: {
				sessionId: "session",
				turnId: "turn",
				toolCallId: "call",
				serverName: "demo",
				toolName: "dashboard",
			},
		});

		expect(attachment).toEqual({
			id: "mcp-app-surface-1",
			resourceUri: "ui://dashboard",
			mimeType: "text/html;profile=mcp-app",
		});
		expect(registry.getSurface("mcp-app-surface-1")).toMatchObject({
			resource: { html: "<main>dashboard</main>" },
			capabilities: { serverTools: false, serverResources: true },
		});
	});

	it("requires both app visibility and the existing explicit autoApprove policy", async () => {
		const client = new FakeClient();
		const registry = new DesktopMcpAppRegistry({ createId: () => "mcp-app-surface-2" });
		await registry.attach({
			client,
			acquireClient: () => ({ client, release: async () => undefined }),
			serverName: "demo",
			serverTools: [
				APP_TOOL,
				{ name: "refresh", inputSchema: { type: "object" as const }, _meta: { ui: { visibility: ["app"] } } },
				{ name: "model_only", inputSchema: { type: "object" as const }, _meta: { ui: { visibility: ["model"] } } },
			],
			autoApproveTools: ["refresh", "model_only"],
			tool: APP_TOOL,
			input: {},
			result: { content: [] },
			context: {
				sessionId: "session",
				turnId: "turn",
				toolCallId: "call",
				serverName: "demo",
				toolName: "dashboard",
			},
		});

		await expect(registry.callTool("mcp-app-surface-2", "refresh", { page: 2 })).resolves.toMatchObject({
			structuredContent: { name: "refresh" },
		});
		await expect(registry.callTool("mcp-app-surface-2", "model_only")).rejects.toThrow("not approved");
		expect(client.calls).toEqual([{ name: "refresh", args: { page: 2 } }]);
	});

	it("waits for Tasks created by an App-visible Tool", async () => {
		const client = new FakeClient();
		client.createTaskFor = "refresh";
		const taskCoordinator = new McpTaskExecutionCoordinator();
		const registry = new DesktopMcpAppRegistry({
			createId: () => "mcp-app-surface-task",
			taskCoordinator,
		});
		await registry.attach({
			client,
			acquireClient: () => ({ client, release: async () => undefined }),
			serverName: "demo",
			serverTools: [
				APP_TOOL,
				{ name: "refresh", inputSchema: { type: "object" as const }, _meta: { ui: { visibility: ["app"] } } },
			],
			autoApproveTools: ["refresh"],
			tool: APP_TOOL,
			input: {},
			result: { content: [] },
			context: {
				sessionId: "session",
				turnId: "turn",
				toolCallId: "call",
				serverName: "demo",
				toolName: "dashboard",
			},
		});

		await expect(registry.callTool("mcp-app-surface-task", "refresh")).resolves.toMatchObject({
			content: [{ type: "text", text: "task done" }],
		});
	});
});

class FakeClient implements IMcpClient {
	readonly calls: Array<{ name: string; args: unknown }> = [];
	createTaskFor?: string;

	async initialize(): Promise<McpInitializeResult> {
		return { protocolVersion: "2026-07-28", serverInfo: { name: "demo", version: "1" } };
	}
	async listTools(): Promise<McpToolsListResult> {
		return { tools: [] };
	}
	async callTool(name: string, args?: Record<string, unknown>): Promise<McpToolCallResult> {
		this.calls.push({ name, args });
		if (name === this.createTaskFor) {
			throw new McpTaskCreatedError("tools/call", {
				resultType: "task",
				taskId: "task-secret",
				status: "working",
				createdAt: "2026-08-30T00:00:00.000Z",
				lastUpdatedAt: "2026-08-30T00:00:00.000Z",
				ttlMs: 60_000,
			});
		}
		return { content: [], structuredContent: { name } };
	}
	async waitForTask(): Promise<McpGetTaskResult> {
		return {
			resultType: "complete",
			taskId: "task-secret",
			status: "completed",
			createdAt: "2026-08-30T00:00:00.000Z",
			lastUpdatedAt: "2026-08-30T00:00:01.000Z",
			ttlMs: 60_000,
			result: { resultType: "complete", content: [{ type: "text", text: "task done" }] },
		};
	}
	async listResources(): Promise<McpResourcesListResult> {
		return { resources: [] };
	}
	async readResource(uri: string): Promise<McpResourceReadResult> {
		return {
			contents: [
				{
					uri,
					mimeType: "text/html;profile=mcp-app",
					text: "<main>dashboard</main>",
				},
			],
		};
	}
	async listPrompts(): Promise<McpPromptsListResult> {
		return { prompts: [] };
	}
	async close(): Promise<void> {}
}
