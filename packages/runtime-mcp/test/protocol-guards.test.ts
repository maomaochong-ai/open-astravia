import { describe, expect, it } from "vitest";
import { isMcpInitializeResult, isMcpResourceReadResult, isMcpToolCallResult } from "../src/protocol/index.js";

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
});
