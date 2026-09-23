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

	it("keeps failures inside the turn they ended instead of splitting it with markers", () => {
		const failed = (entryId: string, timestamp: number) => ({
			type: "message",
			entryId,
			message: { role: "assistant", content: [], stopReason: "error", errorMessage: "Connection error.", timestamp },
		});
		const error = (timestamp: string) => ({ type: "error", message: "Connection error.", timestamp });
		const history = [
			{ type: "message", entryId: "u1", message: { role: "user", content: "这是个什么项目", timestamp: 1 } },
			failed("a1", 2),
			error("2026-09-23T05:45:01.000Z"),
			failed("a2", 3),
			error("2026-09-23T05:45:02.000Z"),
			{ type: "message", entryId: "u2", message: { role: "user", content: "再试一次", timestamp: 4 } },
			error("2026-09-23T05:46:00.000Z"),
		] as unknown as HistoryEntry[];

		const transcript = toTranscript(history);
		expect(transcript.map((entry) => entry.kind)).toEqual(["user", "assistant", "assistant", "user", "assistant"]);
		expect(transcript.filter((entry) => entry.kind === "assistant").map((entry) => [entry.id, entry.error])).toEqual([
			["a1", "Connection error."],
			["a2", "Connection error."],
			["e-1", "Connection error."],
		]);
	});
});
