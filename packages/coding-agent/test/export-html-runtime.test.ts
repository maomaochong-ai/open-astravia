import { createSeededConversationDocument } from "@vetta/runtime-core/conversation";
import { describe, expect, it, vi } from "vitest";
import { APP_NAME } from "../src/config.js";
import {
	createCodingAgentHtmlExportRuntime,
	type ExportTemplateAssets,
	type LegacySessionExportDocument,
} from "../src/export-html/index.js";

const ASSETS: ExportTemplateAssets = {
	template: "<style>{{CSS}}</style><data>{{SESSION_DATA}}</data><script>{{MARKED_JS}}{{HIGHLIGHT_JS}}{{JS}}</script>",
	css: "{{THEME_VARS}}|{{BODY_BG}}|{{CONTAINER_BG}}|{{INFO_BG}}",
	js: "runtime-js",
	markedJs: "marked-js",
	highlightJs: "highlight-js",
};

describe("CodingAgentHtmlExportRuntime", () => {
	it("uses injected assets, theme and writer while projecting a Greenfield conversation", async () => {
		const writes = new Map<string, string>();
		const resolveTheme = vi.fn(() => ({
			colors: { userMessageBg: "#202020", accent: "#abcdef" },
			pageBg: "#010101",
			cardBg: "#020202",
			infoBg: "#030303",
		}));
		const runtime = createCodingAgentHtmlExportRuntime({
			assets: ASSETS,
			themes: { resolve: resolveTheme },
			writer: { write: (path, html) => writes.set(path, html) },
			legacySessions: missingLegacySessions(),
		});
		const document = createSeededConversationDocument(
			{ sessionId: "session-1", createdAt: 1, cwd: "C:/workspace" },
			[
				{
					type: "message",
					id: "call",
					parentId: null,
					timestamp: "2026-01-01T00:00:00.000Z",
					message: {
						role: "assistant",
						content: [{ type: "toolCall", id: "tool-1", name: "custom_tool", arguments: { value: 1 } }],
					},
				},
				{
					type: "message",
					id: "result",
					parentId: "call",
					timestamp: "2026-01-01T00:00:01.000Z",
					message: {
						role: "toolResult",
						toolCallId: "tool-1",
						toolName: "custom_tool",
						content: [{ type: "text", text: "done" }],
						isError: false,
					},
				},
			],
			"result",
		);

		const outputPath = await runtime.exportConversation(document, "session-1.conversation.jsonl", {
			outputPath: "conversation.html",
			themeName: "custom",
			systemPrompt: "system prompt",
			tools: [{ name: "custom_tool", description: "Custom", parameters: { type: "object" } }],
			toolRenderer: {
				renderCall: (name) => `<call>${name}</call>`,
				renderResult: (_name, result) => `<result>${result[0]?.text}</result>`,
			},
		});

		expect(outputPath).toBe("conversation.html");
		expect(resolveTheme).toHaveBeenCalledWith("custom");
		const html = writes.get(outputPath);
		expect(html).toContain("--accent: #abcdef;");
		expect(html).toContain("#010101|#020202|#030303");
		expect(html).toContain("marked-jshighlight-jsruntime-js");
		expect(readSessionData(html)).toMatchObject({
			leafId: "result",
			systemPrompt: "system prompt",
			tools: [{ name: "custom_tool" }],
			renderedTools: {
				"tool-1": {
					callHtml: "<call>custom_tool</call>",
					resultHtml: "<result>done</result>",
				},
			},
		});
	});

	it("keeps legacy session export naming and accepts a string output path", async () => {
		const writes = new Map<string, string>();
		const legacy: LegacySessionExportDocument = {
			header: { type: "session", id: "legacy" },
			entries: [{ type: "message", id: "message-1" }],
			activeLeafId: "message-1",
		};
		const runtime = createCodingAgentHtmlExportRuntime({
			assets: ASSETS,
			themes: { resolve: () => ({ colors: { userMessageBg: "#202020" } }) },
			writer: { write: (path, html) => writes.set(path, html) },
			legacySessions: {
				exists: (path) => path === "fixture.jsonl",
				read: () => legacy,
			},
		});

		await expect(runtime.exportLegacySession("fixture.jsonl")).resolves.toBe(`${APP_NAME}-session-fixture.html`);
		await expect(runtime.exportLegacySession("fixture.jsonl", "chosen.html")).resolves.toBe("chosen.html");
		expect(readSessionData(writes.get("chosen.html"))).toEqual({
			header: legacy.header,
			entries: legacy.entries,
			leafId: legacy.activeLeafId,
		});
	});

	it("reports missing legacy input and rejects ambiguous asset composition", async () => {
		const runtime = createCodingAgentHtmlExportRuntime({
			assets: ASSETS,
			legacySessions: missingLegacySessions(),
		});

		await expect(runtime.exportLegacySession("missing.jsonl")).rejects.toThrow("File not found: missing.jsonl");
		expect(() =>
			createCodingAgentHtmlExportRuntime({
				assets: ASSETS,
				assetsSource: { load: () => ASSETS },
			}),
		).toThrow("mutually exclusive");
	});
});

function missingLegacySessions() {
	return {
		exists: () => false,
		read: (): LegacySessionExportDocument => {
			throw new Error("unexpected legacy session read");
		},
	};
}

function readSessionData(html: string | undefined): unknown {
	if (!html) throw new Error("Expected rendered HTML");
	const encoded = html.match(/<data>([^<]+)<\/data>/)?.[1];
	if (!encoded) throw new Error("Expected encoded session data");
	return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}
