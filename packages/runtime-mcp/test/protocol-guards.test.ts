import { describe, expect, it } from "vitest";
import {
	isMcpAppToolVisibleToApp,
	isMcpAppToolVisibleToModel,
	isMcpDiscoverResult,
	isMcpInitializeResult,
	isMcpInputRequiredResult,
	isMcpPromptsListResult,
	isMcpRequestMeta,
	isMcpResourceReadResult,
	isMcpSubscriptionsListenResult,
	isMcpTask,
	isMcpToolCallResult,
	isMcpToolsListResult,
	MCP_MODERN_PROTOCOL_VERSION,
	readMcpAppResource,
	readMcpAppUiMeta,
	resolveMcpInputRequests,
	selectMcpProtocolVersion,
} from "../src/protocol/index.js";

describe("MCP protocol result guards", () => {
	it("accepts current mixed ToolResult content and extension fields", () => {
		expect(
			isMcpToolCallResult({
				content: [
					{ type: "text", text: "done" },
					{ type: "image", data: "base64", mimeType: "image/png" },
					{ type: "audio", data: "base64", mimeType: "audio/mpeg" },
					{ type: "resource_link", uri: "https://example.test/item", name: "item" },
					{ type: "resource", resource: { uri: "file:///note", text: "note" } },
				],
				structuredContent: { ok: true },
				_meta: { source: "fixture" },
			}),
		).toBe(true);
	});

	it("rejects malformed content and resource results", () => {
		expect(isMcpToolCallResult({ content: [{ type: "image", data: "missing mime" }] })).toBe(false);
		expect(isMcpResourceReadResult({ contents: [{ uri: "file:///x", blob: 123 }] })).toBe(false);
	});

	it("validates the minimum initialize result contract", () => {
		expect(
			isMcpInitializeResult({
				protocolVersion: "2025-11-25",
				serverInfo: { name: "fixture", version: "1.0.0" },
			}),
		).toBe(true);
		expect(isMcpInitializeResult({ protocolVersion: "2025-11-25", serverInfo: {} })).toBe(false);
	});

	it("requires resultType for modern results while preserving legacy omission", () => {
		const result = { content: [{ type: "text", text: "done" }] };
		expect(isMcpToolCallResult(result)).toBe(true);
		expect(isMcpToolCallResult(result, { era: "modern" })).toBe(false);
		expect(isMcpToolCallResult({ ...result, resultType: "complete" }, { era: "modern" })).toBe(true);
		expect(isMcpToolCallResult({ ...result, resultType: "input_required" }, { era: "modern" })).toBe(false);
	});

	it("requires cache metadata on Modern cacheable results", () => {
		const result = { resultType: "complete", tools: [] };
		expect(isMcpToolsListResult(result)).toBe(true);
		expect(isMcpToolsListResult(result, { era: "modern" })).toBe(false);
		expect(isMcpToolsListResult({ ...result, ttlMs: 0, cacheScope: "public" }, { era: "modern" })).toBe(true);
		expect(isMcpToolsListResult({ ...result, ttlMs: 1.5, cacheScope: "private" }, { era: "modern" })).toBe(false);
	});

	it("uses the frozen PromptArgument array contract for prompts/list", () => {
		expect(
			isMcpPromptsListResult({
				prompts: [
					{
						name: "review",
						title: "Code review",
						arguments: [{ name: "language", description: "Language", required: true }],
					},
				],
			}),
		).toBe(true);
		expect(
			isMcpPromptsListResult({
				prompts: [{ name: "legacy-shape", arguments: { type: "object", properties: {} } }],
			}),
		).toBe(false);
	});

	it("validates request metadata using the namespaced 2026 fields", () => {
		expect(
			isMcpRequestMeta({
				"io.modelcontextprotocol/protocolVersion": MCP_MODERN_PROTOCOL_VERSION,
				"io.modelcontextprotocol/clientInfo": { name: "vetta", version: "1.0.0" },
				"io.modelcontextprotocol/clientCapabilities": { extensions: { "io.modelcontextprotocol/ui": {} } },
			}),
		).toBe(true);
		expect(isMcpRequestMeta({ "io.modelcontextprotocol/protocolVersion": MCP_MODERN_PROTOCOL_VERSION })).toBe(false);
	});

	it("validates MRTR, discovery and task contracts", () => {
		expect(
			isMcpInputRequiredResult({
				resultType: "input_required",
				requestState: "opaque-state",
				inputRequests: { approval: { method: "elicitation/create", params: { mode: "form" } } },
			}),
		).toBe(true);
		expect(isMcpInputRequiredResult({ resultType: "input_required" })).toBe(false);
		expect(
			isMcpDiscoverResult({
				resultType: "complete",
				supportedVersions: [MCP_MODERN_PROTOCOL_VERSION],
				capabilities: { tools: {} },
				ttlMs: 60_000,
				cacheScope: "private",
			}),
		).toBe(true);
		expect(
			isMcpTask({
				taskId: "task-1",
				status: "working",
				createdAt: "2026-08-29T00:00:00Z",
				lastUpdatedAt: "2026-08-29T00:00:00Z",
				ttlMs: null,
			}),
		).toBe(true);
	});

	it("selects modern explicitly and keeps unknown requests on the legacy default", () => {
		expect(selectMcpProtocolVersion(MCP_MODERN_PROTOCOL_VERSION)).toMatchObject({ era: "modern", fallback: false });
		expect(selectMcpProtocolVersion("not-supported")).toMatchObject({
			selectedVersion: "2025-11-25",
			era: "legacy",
			fallback: true,
		});
	});

	it("normalizes current and legacy MCP App Tool metadata with array visibility", () => {
		expect(
			readMcpAppUiMeta({
				ui: {
					resourceUri: "ui://dashboard",
					visibility: ["model", "app"],
				},
			}),
		).toMatchObject({ resourceUri: "ui://dashboard", visibility: ["model", "app"] });
		expect(readMcpAppUiMeta({ "ui/resourceUri": "ui://legacy" })).toEqual({ resourceUri: "ui://legacy" });
		expect(readMcpAppUiMeta({ ui: { resourceUri: "https://example.test/app" } })).toBeUndefined();
		expect(readMcpAppUiMeta({ ui: { resourceUri: "ui://app", visibility: "app" } })).toBeUndefined();
		expect(isMcpAppToolVisibleToModel({ _meta: { ui: { visibility: ["app"] } } })).toBe(false);
		expect(isMcpAppToolVisibleToApp({ _meta: { ui: { visibility: ["app"] } } })).toBe(true);
		expect(isMcpAppToolVisibleToApp({})).toBe(true);
	});

	it("accepts only the MCP App HTML MIME and reads resource security metadata", () => {
		expect(
			readMcpAppResource(
				[
					{
						uri: "ui://dashboard",
						mimeType: "text/html;profile=mcp-app",
						text: "<main>safe boundary</main>",
						_meta: {
							ui: {
								csp: { connectDomains: ["https://api.example.test"], frameDomains: [] },
								permissions: { camera: {}, unknown: {} },
							},
						},
					},
				],
				"ui://dashboard",
			),
		).toMatchObject({
			mimeType: "text/html;profile=mcp-app",
			html: "<main>safe boundary</main>",
			meta: { csp: { connectDomains: ["https://api.example.test"], frameDomains: [] }, permissions: { camera: {} } },
		});
		expect(
			readMcpAppResource(
				[{ uri: "ui://dashboard", mimeType: "text/html", text: "<main>wrong profile</main>" }],
				"ui://dashboard",
			),
		).toBeUndefined();
	});

	it("validates the subscription final response correlation metadata", () => {
		expect(
			isMcpSubscriptionsListenResult({
				resultType: "complete",
				_meta: { "io.modelcontextprotocol/subscriptionId": "subscription-1" },
			}),
		).toBe(true);
		expect(isMcpSubscriptionsListenResult({ resultType: "complete", _meta: {} })).toBe(false);
	});

	it("rejects malformed MRTR interaction payloads before invoking host handlers", async () => {
		await expect(
			resolveMcpInputRequests(
				{
					request: {
						method: "elicitation/create",
						params: {
							message: "Invalid form",
							requestedSchema: { type: "object", properties: { count: { type: "unknown" } } },
						},
					},
				},
				{ elicitation: async () => ({ action: "cancel" }) },
				{ serverName: "fixture", method: "tools/call", round: 1 },
			),
		).rejects.toMatchObject({ code: "MCP_INTERACTION_INVALID_REQUEST", method: "elicitation/create" });
	});
});
