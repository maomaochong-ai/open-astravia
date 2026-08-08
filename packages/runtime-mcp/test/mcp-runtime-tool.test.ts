import type { RuntimeToolResult } from "@vetta/runtime-core/kernel";
import { describe, expect, it } from "vitest";
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
		});
	});

	it("uses an explicit preserve policy for the compatible direct execution entry", async () => {
		const result: McpToolCallResult = { content: [{ type: "text", text: "direct result" }] };

		await expect(executeMcpToolCall(createClient(result), TOOL, {})).resolves.toEqual({
			content: result.content,
			details: result,
		});
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
