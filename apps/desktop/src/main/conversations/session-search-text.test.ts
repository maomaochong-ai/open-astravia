import type { HistoryEntry } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { extractSearchMessages, matchSearchMessage, normalizeSearchText } from "./session-search-text.js";

describe("search match snippets", () => {
	it("keeps a long query fully visible instead of cutting it at the preview limit", () => {
		const query = "关键字".repeat(60);
		const text = `${"背景".repeat(200)} ${query} 后续内容`;
		const match = matchSearchMessage([{ role: "user", text, normalizedText: normalizeSearchText(text) }], query);
		expect(match?.snippet).toContain(query);
	});

	it("centers the original match after compatibility characters expand during normalization", () => {
		const text = `${"ﬃ".repeat(200)} needle ${"背景".repeat(200)}`;
		const match = matchSearchMessage(
			[{ role: "assistant", text, normalizedText: normalizeSearchText(text) }],
			"needle",
		);
		expect(match?.snippet).toContain("needle");
	});
});

describe("searchable message extraction", () => {
	function entry(role: string, content: unknown): HistoryEntry {
		// Exercise historical and malformed records at the file-reader boundary too.
		return { type: "message", entryId: "entry-1", message: { role, content, timestamp: 1 } } as HistoryEntry;
	}

	it("includes assistant text blocks even when the same message calls tools", () => {
		const messages = extractSearchMessages([
			entry("assistant", [
				{ type: "thinking", thinking: "hidden-thought", text: "hidden-thought" },
				{ type: "text", text: "预算" },
				{ type: "toolCall", name: "hidden-tool", arguments: { query: "hidden-args" }, text: "hidden-tool-text" },
				{ type: "text", text: "已经整理好了", textSignature: "hidden-signature" },
			]),
		]);
		expect(messages).toEqual([
			{ role: "assistant", entryId: "entry-1", text: "预算 已经整理好了", normalizedText: "预算 已经整理好了" },
		]);
		expect(matchSearchMessage(messages, "预算")?.field).toBe("assistantMessage");
		expect(JSON.stringify(messages)).not.toContain("hidden-");
	});

	it("keeps historical plain assistant replies and untyped user text compatible", () => {
		expect(extractSearchMessages([entry("assistant", "  Plain\nreply ")])).toEqual([
			{ role: "assistant", entryId: "entry-1", text: "Plain reply", normalizedText: "plain reply" },
		]);
		expect(extractSearchMessages([entry("user", [{ text: "Legacy question" }])])[0].text).toBe("Legacy question");
	});

	it("excludes tool-only, non-text and malformed blocks instead of recursively indexing text-like fields", () => {
		const content = [
			{ type: "toolCall", name: "needle", arguments: { content: "needle" }, text: "needle" },
			{ type: "thinking", thinking: "needle", text: "needle" },
			{ type: "image", data: "needle", text: "needle" },
			{ type: "tool_result", content: [{ type: "text", text: "needle" }], text: "needle" },
			{ type: "unknown", text: "needle" },
			{ text: "needle" },
			{ type: "text", text: 123 },
			null,
			"needle",
		];
		expect(extractSearchMessages([entry("assistant", content)])).toEqual([]);
		for (const role of ["toolResult", "tool", "system", "developer"]) {
			expect(extractSearchMessages([entry(role, [{ type: "text", text: "needle" }])])).toEqual([]);
		}
		expect(
			extractSearchMessages([
				{ type: "compaction", summary: "needle", tokensBefore: 1, timestamp: "2026-01-01" },
				{ type: "error", message: "needle", timestamp: "2026-01-01" },
			]),
		).toEqual([]);
	});
});
