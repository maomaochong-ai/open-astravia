import type { HistoryEntry } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { keyForPath, toTranscript } from "./remote-transcript.js";

describe("remote transcript conversion", () => {
	it("derives a stable opaque key that never leaks the path", () => {
		const key = keyForPath("/Users/me/project/.vetta/sessions/a.jsonl");
		expect(key).toMatch(/^[0-9a-f]{24}$/);
		expect(key).toBe(keyForPath("/Users/me/project/.vetta/sessions/a.jsonl"));
		expect(key).not.toBe(keyForPath("/Users/me/project/.vetta/sessions/b.jsonl"));
	});

	it("folds tool results into the assistant entry that issued the call", () => {
		const history = [
			{ type: "message", entryId: "u1", message: { role: "user", content: "read the file", timestamp: 1 } },
			{
				type: "message",
				entryId: "a1",
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "let me look" },
						{ type: "text", text: "Reading…" },
						{ type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } },
					],
					stopReason: "toolUse",
					timestamp: 2,
				},
			},
			{
				type: "message",
				message: {
					role: "toolResult",
					toolCallId: "t1",
					toolName: "read",
					content: [{ type: "text", text: "export const a = 1;" }],
					isError: false,
					timestamp: 3,
				},
			},
			{ type: "compaction", summary: "…", tokensBefore: 10, timestamp: "2026-09-22T10:00:00.000Z" },
		] as unknown as HistoryEntry[];

		expect(toTranscript(history)).toEqual([
			{ kind: "user", id: "u1", text: "read the file", at: 1 },
			{
				kind: "assistant",
				id: "a1",
				text: "Reading…",
				thinking: "let me look",
				toolCalls: [
					{
						toolCallId: "t1",
						toolName: "read",
						args: '{"path":"a.ts"}',
						result: "export const a = 1;",
						isError: false,
					},
				],
				at: 2,
				error: undefined,
			},
			{ kind: "marker", id: "m-1", text: "context compacted", at: Date.parse("2026-09-22T10:00:00.000Z") },
		]);
	});
});
