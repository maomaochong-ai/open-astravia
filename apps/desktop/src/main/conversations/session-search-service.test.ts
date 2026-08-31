import type { HistoryEntry } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import type { DesktopSessionHistoryInfo } from "../../shared/session-access.js";
import type { DesktopSessionSearchRequest, DesktopSessionSearchResult } from "../../shared/session-search.js";
import { mergeSessionSearchResults } from "../../shared/session-search-results.js";
import type { SessionSearchSource } from "./session-search-service.js";
import { SessionSearchService } from "./session-search-service.js";
import { extractSearchMessages, normalizeSearchText } from "./session-search-text.js";

const ACCESS = { readHistory: true, resume: true, rename: true, delete: true } as const;
const sources: SessionSearchSource[] = [{ cwd: "C:/workspace", kind: "project", name: "demo" }];
function session(path: string, name?: string, modifiedAt = 1): DesktopSessionHistoryInfo {
	return { id: path, path, cwd: "C:/workspace", name, firstMessage: "first", modifiedAt, access: ACCESS };
}
function message(
	role: "user" | "assistant" | "system" | "toolResult",
	content: unknown,
	entryId = "user-1",
): HistoryEntry {
	return { type: "message", entryId, message: { role, content, timestamp: 1 } } as HistoryEntry;
}
function fixture(histories: Record<string, HistoryEntry[]> = {}, maxCacheCharacters?: number) {
	const listSessions = vi.fn(async () => [session("title", "季度路线图", 20), session("messages", undefined, 10)]);
	const readHistory = vi.fn((path: string) => ({ history: histories[path] ?? [] }));
	const readFingerprint = vi.fn(async (path: string) => path);
	const engine = new SessionSearchService({
		listSessions,
		readHistory,
		readFingerprint,
		maxCacheCharacters,
		now: () => 1,
		yieldToEventLoop: async () => {},
	});
	const search = async (request: DesktopSessionSearchRequest, selectedSources = sources) => {
		let results: DesktopSessionSearchResult[] = [];
		const summary = await engine.searchStream(
			request,
			selectedSources,
			(result) => {
				results = mergeSessionSearchResults(results, [result], request.limit);
			},
			new AbortController().signal,
		);
		return { results, ...summary };
	};
	return { engine, search, listSessions, readHistory, readFingerprint };
}

describe("SessionSearchService", () => {
	it("searches titles, user messages and assistant text, never tool/thinking/system/error content", async () => {
		const f = fixture({
			messages: [
				message("user", "请查找火星预算"),
				message(
					"assistant",
					[
						{ type: "text", text: "Agent 的火星答复" },
						{ type: "toolCall", id: "call-1", name: "secret", arguments: { query: "secret" }, text: "secret" },
						{ type: "thinking", thinking: "secret", text: "secret" },
					],
					"assistant-1",
				),
				message("toolResult", [{ type: "text", text: "secret" }]),
				message("system", "secret"),
				{ type: "error", message: "secret", timestamp: "2026-01-01" },
			],
		});
		expect((await f.search({ query: "路线图" })).results[0]).toMatchObject({
			session: { path: "title" },
			match: { field: "title" },
		});
		expect((await f.search({ query: "火星预算" })).results[0]).toMatchObject({
			match: { field: "userMessage", entryId: "user-1" },
		});
		expect((await f.search({ query: "火星答复" })).results[0]).toMatchObject({
			match: { field: "assistantMessage", entryId: "assistant-1", snippet: "Agent 的火星答复" },
		});
		expect((await f.search({ query: "secret" })).results).toEqual([]);
	});
	it("extracts only text blocks and normalizes Unicode and whitespace", () => {
		expect(
			extractSearchMessages([
				message("user", [{ type: "text", text: "Alpha" }, { type: "image", data: "secret" }, { text: "Beta" }]),
			]),
		).toEqual([{ role: "user", entryId: "user-1", normalizedText: "alpha beta", text: "Alpha Beta" }]);
		expect(normalizeSearchText("  ＡＢＣ\n Test  ")).toBe("abc test");
	});
	it("returns the matching section of a long title without reading its message history", async () => {
		const f = fixture();
		f.listSessions.mockResolvedValue([session("long-title", `${"背景".repeat(200)}预算计划`)]);
		const { results } = await f.search({ query: "预算" });
		expect(results[0].match).toMatchObject({ field: "title", snippet: expect.stringContaining("预算") });
		expect(f.readHistory).not.toHaveBeenCalled();
	});
	it("keeps the newest matches across sources and message hits even after title hits reach the cap", async () => {
		const f = fixture({ newest: [message("assistant", [{ type: "text", text: "hit" }])] });
		const { results } = await f.search({ query: "hit", limit: 2 }, [
			{ cwd: "C:/old", kind: "conversation", sessions: [session("old", "hit", 10), session("older", "hit", 5)] },
			{ cwd: "C:/new", kind: "project", sessions: [session("newest", "Other", 30), session("new", "hit", 20)] },
		]);
		expect(results.map((result) => result.session.path)).toEqual(["newest", "new"]);
	});
	it("filters both title and body candidates before reading history or applying the cap", async () => {
		const f = fixture({ body: [message("user", "hit")] });
		f.listSessions.mockResolvedValue([
			session("old", "hit", 9),
			session("start", "hit", 10),
			session("body", undefined, 19),
			session("end", "hit", 20),
			session("future-body", undefined, 30),
			session("unknown", "hit", NaN),
		]);
		const { results } = await f.search({ query: "hit", modifiedFrom: 10, modifiedBefore: 20, limit: 2 });
		expect(results.map((entry) => entry.session.path)).toEqual(["body", "start"]);
		expect(f.readHistory.mock.calls.map(([path]) => path)).toEqual(["body"]);
	});
	it("supports either time bound independently", async () => {
		const f = fixture();
		f.listSessions.mockResolvedValue([session("new", "hit", 20), session("old", "hit", 10)]);
		expect((await f.search({ query: "hit", modifiedFrom: 20 })).results.map((entry) => entry.session.path)).toEqual([
			"new",
		]);
		expect((await f.search({ query: "hit", modifiedBefore: 20 })).results.map((entry) => entry.session.path)).toEqual(
			["old"],
		);
	});
	it("does not read older bodies once they cannot enter the newest result window", async () => {
		const f = fixture();
		f.listSessions.mockResolvedValue([session("title", "hit", 30), session("older-body", undefined, 20)]);
		expect((await f.search({ query: "hit", limit: 1 })).results[0].session.path).toBe("title");
		expect(f.readHistory).not.toHaveBeenCalled();
	});
	it("reuses unchanged user text, rechecks fingerprints, and refreshes renamed/deleted metadata", async () => {
		const f = fixture({ messages: [message("user", "first")] });
		await f.search({ query: "first" });
		await f.search({ query: "first" });
		expect(f.listSessions).toHaveBeenCalledTimes(1);
		expect(f.readHistory).toHaveBeenCalledTimes(2);
		f.engine.invalidate();
		await f.search({ query: "first" });
		expect(f.readHistory).toHaveBeenCalledTimes(2);
		f.readFingerprint.mockResolvedValue("changed");
		await f.search({ query: "first" });
		expect(f.readHistory).toHaveBeenCalledTimes(4);
		f.listSessions.mockResolvedValue([session("title", "renamed")]);
		f.engine.invalidate();
		expect((await f.search({ query: "renamed" })).results).toHaveLength(1);
		expect((await f.search({ query: "first" })).results).toHaveLength(0);
	});
	it("emits a title before a later source finishes loading", async () => {
		const f = fixture();
		let release!: (sessions: DesktopSessionHistoryInfo[]) => void;
		const blocked = new Promise<DesktopSessionHistoryInfo[]>((done) => {
			release = done;
		});
		f.listSessions.mockResolvedValueOnce([session("title", "hit")]).mockReturnValueOnce(blocked);
		let sawHit!: () => void;
		const hit = new Promise<void>((done) => {
			sawHit = done;
		});
		const run = f.engine.searchStream(
			{ query: "hit" },
			[...sources, { cwd: "C:/later", kind: "project" }],
			() => sawHit(),
			new AbortController().signal,
		);
		await hit;
		expect(f.readHistory).not.toHaveBeenCalled();
		release([]);
		await run;
	});
	it("emits even one message hit immediately and cancellation stops remaining reads", async () => {
		const f = fixture({ title: [message("user", "hit")], messages: [message("user", "hit")] });
		const controller = new AbortController();
		const onResult = vi.fn(() => controller.abort());
		await expect(f.engine.searchStream({ query: "hit" }, sources, onResult, controller.signal)).rejects.toThrow();
		expect(onResult).toHaveBeenCalledOnce();
		expect(f.readHistory).toHaveBeenCalledTimes(1);
	});
	it("applies type and project filters before reading history or enforcing the result cap", async () => {
		const f = fixture();
		const catalog: SessionSearchSource[] = [
			{
				cwd: "C:/default",
				kind: "conversation",
				sessions: Array.from({ length: 150 }, (_, i) => session(`default-${i}`, "hit")),
			},
			{ cwd: "C:/target", kind: "project", sessions: [session("target", "hit")] },
		];
		expect(
			(await f.search({ query: "hit", limit: 1, sourceKind: "project", projectCwd: "C:/target" }, catalog))
				.results[0]?.session.path,
		).toBe("target");
		expect((await f.search({ query: "hit", projectCwd: "C:/unknown" }, catalog)).results).toEqual([]);
		const capped = await f.search({ query: "hit" }, catalog);
		expect(capped.results).toHaveLength(100);
		expect(capped.limited).toBe(true);
		expect(f.readHistory).not.toHaveBeenCalled();
	});
	it.each(["user", "assistant"] as const)(
		"evicts cached %s text instead of retaining unbounded histories",
		async (role) => {
			const f = fixture({ title: [message(role, "first")], messages: [message(role, "other")] }, 10);
			await f.search({ query: "missing" });
			await f.search({ query: "missing" });
			expect(f.readHistory).toHaveBeenCalledTimes(4);
		},
	);
	it("refreshes assistant replies when their history fingerprint changes", async () => {
		const f = fixture({ messages: [message("assistant", [{ type: "text", text: "draft" }])] });
		f.listSessions.mockResolvedValue([session("messages")]);
		expect((await f.search({ query: "draft" })).results[0].match.field).toBe("assistantMessage");
		await f.search({ query: "draft" });
		expect(f.readHistory).toHaveBeenCalledTimes(1);
		f.readFingerprint.mockResolvedValue("updated");
		f.readHistory.mockReturnValue({ history: [message("assistant", [{ type: "text", text: "final reply" }])] });
		expect((await f.search({ query: "final reply" })).results[0].match.snippet).toBe("final reply");
		expect((await f.search({ query: "draft" })).results).toEqual([]);
		expect(f.readHistory).toHaveBeenCalledTimes(2);
	});
	it("does not cache metadata invalidated while its read was still pending", async () => {
		const f = fixture();
		let release!: (value: DesktopSessionHistoryInfo[]) => void;
		f.listSessions.mockReturnValueOnce(
			new Promise((done) => {
				release = done;
			}),
		);
		const first = f.search({ query: "title" });
		f.engine.invalidate();
		release([session("old", "title")]);
		await first;
		f.listSessions.mockResolvedValue([session("new", "title")]);
		expect((await f.search({ query: "title" })).results[0]?.session.path).toBe("new");
	});
	it("keeps title hits when files are unreadable and reports partial results", async () => {
		const f = fixture();
		f.readHistory.mockImplementation(() => {
			throw new Error("corrupt");
		});
		const result = await f.search({ query: "季度" });
		expect(result.results).toHaveLength(1);
		expect(result.skipped).toBe(1);
	});
});
