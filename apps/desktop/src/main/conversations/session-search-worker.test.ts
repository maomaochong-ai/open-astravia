import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { createAssistantMessage } from "@vetta/ai";
import { FileConversationRepository } from "@vetta/runtime-node/conversation";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import type { DesktopSessionSearchEvent, DesktopSessionSearchRequest } from "../../shared/session-search.js";
import { mergeSessionSearchResults } from "../../shared/session-search-results.js";
import type { SessionSearchWorkerRequest } from "./session-search-worker-protocol.js";

describe("session search worker boundary", () => {
	it("searches user and assistant text in native/legacy files, excluding thinking and tool payloads", async () => {
		// Keep temporary bundle beneath this package so external workspace imports resolve normally.
		const packageDir = fileURLToPath(new URL("../../../", import.meta.url));
		const temporary = await mkdtemp(join(packageDir, ".session-search-test-"));
		if (
			dirname(resolve(temporary)) !== resolve(packageDir) ||
			!basename(temporary).startsWith(".session-search-test-")
		) {
			throw new Error("Unexpected test directory");
		}
		let worker: Worker | undefined;
		try {
			await build({
				configFile: false,
				logLevel: "silent",
				build: {
					lib: {
						entry: fileURLToPath(new URL("../session-search-worker.ts", import.meta.url)),
						formats: ["es"],
						fileName: () => "worker.mjs",
					},
					outDir: join(temporary, "bundle"),
					minify: false,
					rollupOptions: { external: [/^node:/, /^@vetta\//] },
				},
			});
			const sessionDir = join(temporary, "sessions");
			const repository = new FileConversationRepository({ rootDir: sessionDir });
			const nativeReply = createAssistantMessage(
				{ api: "openai-completions", provider: "openai", model: "test" },
				{ timestamp: 3, stopReason: "toolUse" },
			);
			nativeReply.content = [
				{ type: "text", text: "agent-only native reply" },
				{ type: "thinking", thinking: "thought-only" },
				{ type: "toolCall", id: "call-1", name: "tool-only", arguments: { query: "tool-only" } },
			];
			await repository.create({ sessionId: "native", createdAt: 1, cwd: temporary });
			await repository.append("native", 0, [
				{
					type: "message.appended",
					sessionId: "native",
					turnId: "turn-1",
					timestamp: 2,
					message: { role: "user", content: "searchable native budget", timestamp: 2 },
				},
				{ type: "message.appended", sessionId: "native", turnId: "turn-1", timestamp: 3, message: nativeReply },
				{
					type: "message.appended",
					sessionId: "native",
					turnId: "turn-1",
					timestamp: 4,
					message: {
						role: "toolResult",
						toolCallId: "call-1",
						toolName: "tool-only",
						content: [{ type: "text", text: "tool-only result" }],
						isError: false,
						timestamp: 4,
					},
				},
			]);
			await repository.close();
			const legacyPath = join(sessionDir, "legacy.jsonl");
			const legacy = [
				{ type: "session", version: 3, id: "legacy", cwd: temporary, timestamp: "2026-01-01T00:00:00.000Z" },
				{
					type: "message",
					id: "user-1",
					parentId: null,
					timestamp: "2026-01-01T00:00:00.001Z",
					message: { role: "user", content: "searchable legacy budget", timestamp: 2 },
				},
				{
					type: "message",
					id: "agent-1",
					parentId: "user-1",
					timestamp: "2026-01-01T00:00:00.002Z",
					message: { role: "assistant", content: "agent-only ".repeat(500_000), timestamp: 3 },
				},
				{
					type: "message",
					id: "tool-1",
					parentId: "agent-1",
					timestamp: "2026-01-01T00:00:00.003Z",
					message: {
						role: "toolResult",
						toolCallId: "call-1",
						toolName: "tool-only",
						content: [{ type: "text", text: "tool-only ".repeat(500_000) }],
						isError: false,
						timestamp: 4,
					},
				},
			];
			await writeFile(legacyPath, legacy.map((record) => JSON.stringify(record)).join("\n"));
			const original = await readFile(legacyPath, "utf8");
			worker = new Worker(join(temporary, "bundle", "worker.mjs"));
			const activeWorker = worker;
			const search = (query: string, filters: Omit<DesktopSessionSearchRequest, "query"> = {}) =>
				new Promise<DesktopSessionSearchEvent[]>((done, reject) => {
					const events: DesktopSessionSearchEvent[] = [];
					const onMessage = (event: DesktopSessionSearchEvent) => {
						events.push(event);
						if (event.done) {
							activeWorker.removeListener("message", onMessage);
							activeWorker.removeListener("error", reject);
							done(events);
						}
					};
					activeWorker.on("message", onMessage);
					activeWorker.once("error", reject);
					activeWorker.postMessage({
						type: "start",
						requestId: query,
						request: { query, ...filters },
						sources: [{ cwd: temporary, kind: "project", sessionDir }],
						roots: [{ cwd: temporary, sessionDir }],
					} satisfies SessionSearchWorkerRequest);
				});
			const events = await search("searchable");
			expect(events.at(-1)).toMatchObject({ done: true, skipped: 0, limited: false });
			expect(events.flatMap((event) => event.results ?? [])).toHaveLength(2);
			expect(events[0].done).toBe(false);
			expect(JSON.stringify(events)).not.toContain("agent-only");
			const replies = (await search("agent-only")).flatMap((event) => event.results ?? []);
			expect(replies).toHaveLength(2);
			for (const reply of replies) {
				expect(reply.match).toMatchObject({
					field: "assistantMessage",
					snippet: expect.stringContaining("agent-only"),
				});
				expect(reply.match.snippet.length).toBeLessThan(250);
			}
			for (const query of ["tool-only", "thought-only"]) {
				expect((await search(query)).flatMap((event) => event.results ?? [])).toEqual([]);
			}
			for (const reply of replies) {
				const time = reply.session.modifiedAt;
				const filtered = (await search("agent-only", { modifiedFrom: time, modifiedBefore: time + 1 })).flatMap(
					(event) => event.results ?? [],
				);
				expect(filtered.some((entry) => entry.session.path === reply.session.path)).toBe(true);
				expect(filtered.every((entry) => entry.session.modifiedAt === time)).toBe(true);
			}
			const excluded = await search("agent-only", {
				modifiedBefore: Math.min(...replies.map((entry) => entry.session.modifiedAt)),
			});
			expect(excluded.flatMap((event) => event.results ?? [])).toEqual([]);
			const capped = await search("agent-only", { limit: 1 });
			expect(
				mergeSessionSearchResults(
					[],
					capped.flatMap((event) => event.results ?? []),
					1,
				)[0].session.path,
			).toBe(mergeSessionSearchResults([], replies, 1)[0].session.path);
			expect(await readFile(legacyPath, "utf8")).toBe(original);
			const config = await readFile(fileURLToPath(new URL("../../../vite.main.config.ts", import.meta.url)), "utf8");
			expect(config).toContain(
				'"session-search-worker": resolve(process.cwd(), "src/main/session-search-worker.ts")',
			);
		} finally {
			await worker?.terminate();
			await rm(temporary, { recursive: true, force: true });
		}
	}, 30_000);
});
