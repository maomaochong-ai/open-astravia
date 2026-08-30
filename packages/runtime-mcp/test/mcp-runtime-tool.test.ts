import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
import type { McpAppExecutionHost } from "../src/apps/index.js";
import { McpTaskCreatedError } from "../src/client/index.js";
import type {
	IMcpClient,
	McpInitializeResult,
	McpPromptsListResult,
	McpResourceReadResult,
	McpResourcesListResult,
	McpToolCallResult,
	McpToolsListResult,
} from "../src/protocol/index.js";
import {
	createMcpRuntimeTool,
	createMcpToolResultPolicy,
	executeMcpToolCall,
	type McpToolResultArtifactStore,
	type McpToolResultArtifactWriteRequest,
	type McpToolResultOffloadDetails,
	type McpToolResultPolicy,
} from "../src/tools/index.js";

describe("MCP Runtime Tool result policy", () => {
	it("preserves the existing result shape below the inline limit", async () => {
		const result: McpToolCallResult = {
			content: [
				{ type: "text", text: "result" },
				{ type: "resource", resource: { uri: "file:///value", text: "resource text" } },
			],
		};
		const store = new RecordingArtifactStore();

		const projected = await execute(result, store, 1_000);

		expect(projected).toEqual({
			content: [
				{ type: "text", text: "result" },
				{ type: "text", text: "Resource: file:///value\nresource text" },
			],
			details: result,
		});
		expect(store.requests).toEqual([]);
	});

	it("offloads a large error result and returns a UTF-8-safe head-tail preview", async () => {
		const originalText = `开头-${"中".repeat(100)}-结尾`;
		const result: McpToolCallResult = {
			content: [{ type: "text", text: originalText }],
			isError: true,
		};
		const store = new RecordingArtifactStore();

		const projected = await execute(result, store, 80);
		const text = projected.content[0]?.type === "text" ? projected.content[0].text : "";
		const details = projected.details as McpToolResultOffloadDetails;

		expect(text).toContain("开头");
		expect(text).toContain("结尾");
		expect(text).toContain("artifact://mcp-result/1");
		expect(text).not.toContain("�");
		expect(text).not.toBe(originalText);
		expect(details).toMatchObject({
			isError: true,
			offloaded: true,
			textTruncated: true,
			artifact: { reference: "artifact://mcp-result/1", mediaType: "application/json" },
			summary: { contentItems: 1, imageCount: 0, resourceCount: 0 },
		});
		expect(details.summary.textBytes).toBe(new TextEncoder().encode(originalText).length);
		expect(store.requests[0]?.byteLength).toBe(new TextEncoder().encode(JSON.stringify(result)).length);
		expect(JSON.parse(store.requests[0]?.data ?? "")).toEqual(result);
		expect(JSON.stringify(projected.details)).not.toContain(originalText);
	});

	it("keeps image content while offloading the raw response and binary resource details", async () => {
		const imageData = "a".repeat(200);
		const blob = "b".repeat(200);
		const result: McpToolCallResult = {
			content: [
				{ type: "image", data: imageData, mimeType: "image/png" },
				{
					type: "resource",
					resource: { uri: "file:///binary", blob, mimeType: "application/octet-stream" },
				},
			],
		};
		const store = new RecordingArtifactStore();

		const projected = await execute(result, store, 80);

		expect(projected.content).toEqual([
			{
				type: "text",
				text: expect.stringContaining("Full result: artifact://mcp-result/1"),
			},
			{ type: "image", data: imageData, mimeType: "image/png" },
		]);
		expect(projected.content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("Resource: file:///binary"),
		});
		expect(JSON.stringify(projected.details)).not.toContain(imageData);
		expect(JSON.stringify(projected.details)).not.toContain(blob);
		expect(JSON.parse(store.requests[0]?.data ?? "")).toEqual(result);
	});

	it("retains only bounded safe audio for Desktop playback after raw-result offload", async () => {
		const result: McpToolCallResult = {
			content: [
				{ type: "audio", data: "YXVkaW8=", mimeType: "audio/mpeg" },
				{ type: "audio", data: "PHN2Zz4=", mimeType: "image/svg+xml" },
			],
		};

		const projected = await execute(result, new RecordingArtifactStore(), 32);
		const details = projected.details as McpToolResultOffloadDetails;

		expect(details.media).toEqual([{ type: "audio", data: "YXVkaW8=", mimeType: "audio/mpeg" }]);
		expect(projected.content).toEqual([{ type: "text", text: expect.stringContaining("Full result:") }]);
	});

	it("projects current MCP content blocks without dropping embedded image resources", async () => {
		const result: McpToolCallResult = {
			content: [
				{ type: "audio", data: "YXVkaW8=", mimeType: "audio/mpeg" },
				{ type: "resource_link", uri: "https://example.test/report", name: "report", description: "Report" },
				{
					type: "resource",
					resource: { uri: "https://example.test/image", blob: "aW1hZ2U=", mimeType: "image/png" },
				},
			],
		};

		await expect(execute(result, new RecordingArtifactStore(), 10_000)).resolves.toEqual({
			content: [
				{ type: "text", text: "Audio content: audio/mpeg" },
				{ type: "text", text: "Resource link: report (https://example.test/report)\nReport" },
				{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
			],
			details: result,
		});
	});

	it("falls back to the complete result when artifact storage fails", async () => {
		const result: McpToolCallResult = { content: [{ type: "text", text: "x".repeat(200) }] };
		const store = new RecordingArtifactStore(true);

		await expect(execute(result, store, 32)).resolves.toEqual({
			content: result.content,
			details: result,
		});
	});

	it("preserves the established client exception projection", async () => {
		const client = createClient(undefined, new Error("remote failed"));
		const tool = createMcpRuntimeTool(TOOL, client, "search", {
			resultPolicy: createMcpToolResultPolicy({ artifactStore: new RecordingArtifactStore() }),
		});

		await expect(tool.execute(EXECUTION_REQUEST)).resolves.toEqual({
			content: [{ type: "text", text: "Error calling MCP tool 'lookup': remote failed" }],
			details: { content: [{ type: "text", text: "remote failed" }], isError: true },
			isError: true,
		});
	});

	it("propagates MCP isError and preserves structured content", async () => {
		const result: McpToolCallResult = {
			content: [{ type: "text", text: "remote validation failed" }],
			structuredContent: { code: "INVALID_INPUT", retryable: false },
			isError: true,
		};

		await expect(execute(result, new RecordingArtifactStore(), 10_000)).resolves.toEqual({
			content: [{ type: "text", text: "remote validation failed" }],
			details: result,
			isError: true,
		});
	});

	it("uses an explicit preserve policy for the compatible direct execution entry", async () => {
		const result: McpToolCallResult = { content: [{ type: "text", text: "direct result" }] };

		await expect(executeMcpToolCall(createClient(result), TOOL, {})).resolves.toEqual({
			content: result.content,
			details: result,
		});
	});

	it("turns a created MCP Task back into the original ToolResult contract", async () => {
		const created = {
			resultType: "task" as const,
			taskId: "task-1",
			status: "working" as const,
			createdAt: "2026-08-30T00:00:00.000Z",
			lastUpdatedAt: "2026-08-30T00:00:00.000Z",
			ttlMs: null,
		};
		const client: IMcpClient = {
			...createClient({ content: [] }),
			callTool: async () => {
				throw new McpTaskCreatedError("tools/call", created);
			},
			waitForTask: async (_params, options) => {
				const result = {
					...created,
					resultType: "complete" as const,
					status: "completed" as const,
					lastUpdatedAt: "2026-08-30T00:00:01.000Z",
					result: { resultType: "complete", content: [{ type: "text" as const, text: "task done" }] },
				};
				await options?.onStatus?.(result);
				return result;
			},
		};
		const tool = createMcpRuntimeTool(TOOL, client, "search");

		await expect(tool.execute(EXECUTION_REQUEST)).resolves.toMatchObject({
			content: [{ type: "text", text: "task done" }],
		});
	});

	it("marks descriptionless MCP tools as low-confidence instead of implying a capability", () => {
		const tool = createMcpRuntimeTool(
			{ name: "mystery", description: "   ", inputSchema: { type: "object" as const } },
			createClient({ content: [] }),
			"external",
		);

		expect(tool.description).toContain('tool "mystery" from server "external"');
		expect(tool.description).toContain("did not provide a capability description");
		expect(tool.description).toContain("do not infer behavior from the server name alone");
	});

	it("always invokes the Runtime Tool policy with complete execution identity", async () => {
		const resultPolicy: McpToolResultPolicy = {
			project: async (_result, context) => ({
				content: [{ type: "text", text: JSON.stringify(context) }],
			}),
		};
		const tool = createMcpRuntimeTool(TOOL, createClient({ content: [] }), "search", { resultPolicy });

		await expect(tool.execute(EXECUTION_REQUEST)).resolves.toEqual({
			content: [
				{
					type: "text",
					text: JSON.stringify({
						sessionId: "session",
						turnId: "turn",
						toolCallId: "call",
						serverName: "search",
						toolName: "lookup",
					}),
				},
			],
		});
	});

	it("attaches only an opaque MCP App descriptor after the ordinary Tool result succeeds", async () => {
		const result: McpToolCallResult = { content: [{ type: "text", text: "app result" }] };
		const appHost: McpAppExecutionHost = {
			attach: async (request) => ({
				id: `surface-${request.context.toolCallId}`,
				resourceUri: "ui://dashboard",
				mimeType: "text/html;profile=mcp-app",
			}),
		};
		const appTool = createMcpRuntimeTool(
			{ ...TOOL, _meta: { ui: { resourceUri: "ui://dashboard" } } },
			createClient(result),
			"search",
			{
				resultPolicy: createMcpToolResultPolicy({ artifactStore: new RecordingArtifactStore() }),
				appHost,
				acquireAppClient: () => ({ client: createClient(result), release: () => undefined }),
				serverTools: [TOOL],
			},
		);

		await expect(appTool.execute(EXECUTION_REQUEST)).resolves.toMatchObject({
			details: {
				content: [{ type: "text", text: "app result" }],
				_meta: {
					"io.vetta/mcpApp": {
						id: "surface-call",
						resourceUri: "ui://dashboard",
						mimeType: "text/html;profile=mcp-app",
					},
				},
			},
		});
	});
});

async function execute(
	result: McpToolCallResult,
	store: McpToolResultArtifactStore,
	maxInlineResultBytes: number,
): Promise<RuntimeToolResult> {
	const tool = createMcpRuntimeTool(TOOL, createClient(result), "search", {
		resultPolicy: createMcpToolResultPolicy({ artifactStore: store, maxInlineResultBytes }),
	});
	return tool.execute(EXECUTION_REQUEST);
}

class RecordingArtifactStore implements McpToolResultArtifactStore {
	readonly requests: McpToolResultArtifactWriteRequest[] = [];

	constructor(private readonly fail = false) {}

	async write(request: McpToolResultArtifactWriteRequest) {
		this.requests.push(request);
		if (this.fail) throw new Error("storage unavailable");
		return { reference: `artifact://mcp-result/${this.requests.length}` };
	}
}

function createClient(result?: McpToolCallResult, error?: Error): IMcpClient {
	return {
		async initialize(): Promise<McpInitializeResult> {
			throw new Error("Not used");
		},
		async listTools(): Promise<McpToolsListResult> {
			throw new Error("Not used");
		},
		async callTool(): Promise<McpToolCallResult> {
			if (error) throw error;
			if (!result) throw new Error("Missing result");
			return result;
		},
		async listResources(): Promise<McpResourcesListResult> {
			throw new Error("Not used");
		},
		async readResource(): Promise<McpResourceReadResult> {
			throw new Error("Not used");
		},
		async listPrompts(): Promise<McpPromptsListResult> {
			throw new Error("Not used");
		},
		async close(): Promise<void> {},
	};
}

const TOOL = {
	name: "lookup",
	description: "Lookup a value",
	inputSchema: { type: "object" as const },
};

const EXECUTION_REQUEST = {
	sessionId: "session",
	turnId: "turn",
	toolCallId: "call",
	input: {},
	signal: new AbortController().signal,
};
