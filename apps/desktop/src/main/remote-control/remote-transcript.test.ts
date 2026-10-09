import type { RemoteTranscriptEntry } from "@vetta/remote-control";
import { REMOTE_MAX_TOOL_RESULT_CHARS } from "@vetta/remote-control";
import type { HistoryEntry } from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import { findToolResult, keyForPath, pageTranscript, toTranscript } from "./remote-transcript.js";

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

	describe("findToolResult", () => {
		const result = (toolCallId: string, text: string, isError = false) => ({
			type: "message",
			message: {
				role: "toolResult",
				toolCallId,
				toolName: "jsk_focus_parcels",
				content: [{ type: "text", text }],
				isError,
				timestamp: 1,
			},
		});

		it("returns the whole result that history and events cut to a preview", () => {
			const text = JSON.stringify({
				results: Array.from({ length: 200 }, (_, id) => ({ id, name: `parcel ${id}` })),
			});
			expect(text.length).toBeGreaterThan(1_200);
			const history = [result("t1", text)] as unknown as HistoryEntry[];

			expect(toTranscript(history)).toEqual([]);
			expect(findToolResult(history, "t1")).toEqual({
				toolCallId: "t1",
				toolName: "jsk_focus_parcels",
				result: text,
				isError: false,
			});
		});

		it("prefers the newest result when a call id repeats and keeps the error flag", () => {
			const history = [
				result("t1", "old"),
				result("t2", "other"),
				result("t1", "new", true),
			] as unknown as HistoryEntry[];
			expect(findToolResult(history, "t1")).toMatchObject({ result: "new", isError: true });
		});

		it("answers not_found for an unknown or still running call", () => {
			const history = [result("t1", "done")] as unknown as HistoryEntry[];
			expect(() => findToolResult(history, "t9")).toThrow(expect.objectContaining({ code: "not_found" }));
		});

		it("refuses a result that would not fit a sealed frame", () => {
			const history = [result("t1", "x".repeat(REMOTE_MAX_TOOL_RESULT_CHARS + 1))] as unknown as HistoryEntry[];
			expect(() => findToolResult(history, "t1")).toThrow(expect.objectContaining({ code: "too_large" }));
		});
	});

	describe("history pages", () => {
		const turns = (count: number): RemoteTranscriptEntry[] =>
			Array.from({ length: count }, (_, turn): RemoteTranscriptEntry[] => [
				{ kind: "user", id: `u${turn}`, text: `question ${turn}` },
				{ kind: "assistant", id: `a${turn}-0`, text: "step", toolCalls: [] },
				{ kind: "assistant", id: `a${turn}-1`, text: "answer", toolCalls: [] },
			]).flat();

		it("sends the newest 240 entries to a phone that asks for no page", () => {
			const page = pageTranscript(turns(100), {});
			expect(page.entries).toHaveLength(240);
			expect(page.entries.at(-1)?.id).toBe("a99-1");
			expect(page.hasMore).toBe(true);
		});

		it("pages back from an entry, starting each page at a user message", () => {
			const entries = turns(10);
			const newest = pageTranscript(entries, { limit: 7 });
			// Seven would start mid-turn; the partial turn waits for the older page.
			expect(newest.entries.map((entry) => entry.id)).toEqual(["u8", "a8-0", "a8-1", "u9", "a9-0", "a9-1"]);
			expect(newest.hasMore).toBe(true);
			const older = pageTranscript(entries, { limit: 7, before: "u8" });
			expect(older.entries[0]?.id).toBe("u6");
			expect(older.entries.at(-1)?.id).toBe("a7-1");
			const oldest = pageTranscript(entries, { limit: 7, before: "u2" });
			expect(oldest.entries.map((entry) => entry.id)).toEqual(["u0", "a0-0", "a0-1", "u1", "a1-0", "a1-1"]);
			expect(oldest.hasMore).toBe(false);
		});

		it("splits a turn longer than half a page instead of sending a page of almost nothing", () => {
			const entries: RemoteTranscriptEntry[] = [
				{ kind: "user", id: "u0", text: "q" },
				...Array.from(
					{ length: 6 },
					(_, step): RemoteTranscriptEntry => ({ kind: "assistant", id: `a0-${step}`, text: "s", toolCalls: [] }),
				),
				{ kind: "user", id: "u1", text: "q" },
				{ kind: "assistant", id: "a1", text: "s", toolCalls: [] },
			];
			const page = pageTranscript(entries, { limit: 5 });
			expect(page.entries.map((entry) => entry.id)).toEqual(["a0-3", "a0-4", "a0-5", "u1", "a1"]);
			expect(pageTranscript(entries, { limit: 5, before: "a0-3" }).entries[0]?.id).toBe("u0");
		});

		it("answers an unknown cursor with an empty last page", () => {
			expect(pageTranscript(turns(3), { limit: 5, before: "gone" })).toEqual({ entries: [], hasMore: false });
		});

		it("fits a page into one frame however many entries it may hold", () => {
			const long = "长".repeat(50_000);
			const entries = Array.from(
				{ length: 20 },
				(_, index): RemoteTranscriptEntry => ({
					kind: "assistant",
					id: `a${index}`,
					text: long,
					toolCalls: [],
				}),
			);
			const page = pageTranscript(entries, { limit: 20 });
			expect(Buffer.byteLength(JSON.stringify(page.entries))).toBeLessThanOrEqual(400 * 1024);
			expect(page.entries.length).toBeGreaterThan(0);
			expect(page.entries.at(-1)?.id).toBe("a19");
			expect(page.hasMore).toBe(true);
		});

		it("cuts an entry too big for a page of its own", () => {
			const huge: RemoteTranscriptEntry = {
				kind: "assistant",
				id: "a",
				text: "x".repeat(600_000),
				thinking: "t".repeat(600_000),
				toolCalls: [],
			};
			const [entry] = pageTranscript([huge], { limit: 10 }).entries;
			expect(entry?.kind === "assistant" && entry.text.length).toBe(100_001);
			expect(entry?.kind === "assistant" && entry.thinking?.length).toBe(20_001);
		});
	});
});
