import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserMessage } from "@astravia/ai";
import { createNodeLegacySessionHost } from "@astravia/runtime-node/host";
import { afterEach, describe, expect, it } from "vitest";
import { LegacyRuntimeSessionCatalog } from "../../src/sessions/legacy/catalog.js";
import { LegacyRuntimeSessionFileHistoryReader } from "../../src/sessions/legacy/history-reader.js";

describe("Legacy session format boundary", () => {
	const temporaryDirectories: string[] = [];

	afterEach(() => {
		for (const directory of temporaryDirectories.splice(0)) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("lists, renames, and reads Legacy JSONL without an AgentSession", async () => {
		const directory = createTemporaryDirectory(temporaryDirectories);
		const sessionPath = join(directory, "legacy.jsonl");
		writeFileSync(
			sessionPath,
			`${legacySessionRecords()
				.map((record) => JSON.stringify(record))
				.join("\n")}\n`,
		);
		writeFileSync(
			join(directory, "native.conversation.jsonl"),
			`${JSON.stringify({ type: "conversation", sessionId: "native" })}\n`,
		);

		const host = createNodeLegacySessionHost({ defaultCwd: directory, sessionsDirectory: directory });
		const catalog = new LegacyRuntimeSessionCatalog(host);
		const sessions = await catalog.listSessions("C:\\workspace", directory);
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({
			id: "legacy-session",
			cwd: "C:\\workspace",
			firstMessage: "first prompt",
			lastMessagePreview: "final answer",
			parentSessionPath: "parent.jsonl",
			parentEntryId: "parent-entry",
			modifiedAt: 300,
		});

		await catalog.renameSession(sessionPath, "  renamed session  ");
		expect((await catalog.listSessions("C:\\workspace", directory))[0]?.name).toBe("renamed session");
		expect(existsSync(`${sessionPath}.lock`)).toBe(false);

		const history = new LegacyRuntimeSessionFileHistoryReader(host).read(sessionPath).history;
		expect(history.filter(({ type }) => type === "message")).toHaveLength(3);
	});

	it("enforces the single-writer lease and reclaims it after release", () => {
		const directory = createTemporaryDirectory(temporaryDirectories);
		const sessionPath = join(directory, "lease.jsonl");
		writeFileSync(sessionPath, "");

		const host = createNodeLegacySessionHost({ defaultCwd: directory, sessionsDirectory: directory });
		const first = host.acquireLease(sessionPath);
		expect(first.kind).toBe("acquired");
		const second = host.acquireLease(sessionPath);
		expect(second.kind).toBe("locked");
		if (first.kind !== "acquired") throw new Error("Expected the first lease to be acquired");
		first.lease.release();
		const third = host.acquireLease(sessionPath);
		expect(third.kind).toBe("acquired");
		if (third.kind === "acquired") third.lease.release();
	});

	it("reuses the cached session summary until the file changes", async () => {
		const directory = createTemporaryDirectory(temporaryDirectories);
		const sessionPath = join(directory, "cached.jsonl");
		const write = (records: readonly object[]): void => {
			writeFileSync(sessionPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
		};
		write(legacySessionRecords());

		const inner = createNodeLegacySessionHost({ defaultCwd: directory, sessionsDirectory: directory });
		let reads = 0;
		const catalog = new LegacyRuntimeSessionCatalog({
			...inner,
			readText: (path) => {
				reads += 1;
				return inner.readText(path);
			},
		});

		await catalog.listSessions("C:\\workspace", directory);
		expect(reads).toBe(1);
		// 文件没变：第二次列表只花一次 stat，不再重新解析整份 JSONL。
		await catalog.listSessions("C:\\workspace", directory);
		expect(reads).toBe(1);

		// mtime 可能和上一次落在同一毫秒，等一格再追写，让「文件变了」这件事可观测。
		await new Promise((resolve) => setTimeout(resolve, 10));
		write([...legacySessionRecords(), { ...legacySessionRecords()[2], id: "assistant-2", parentId: "assistant" }]);
		await catalog.listSessions("C:\\workspace", directory);
		expect(reads).toBe(2);
	});

	it("keeps a session whose header has no cwd, using the listed project as fallback", async () => {
		const directory = createTemporaryDirectory(temporaryDirectories);
		const sessionPath = join(directory, "no-cwd.jsonl");
		const [header, ...rest] = legacySessionRecords();
		const { cwd: _omitted, ...headerWithoutCwd } = header as Record<string, unknown>;
		writeFileSync(sessionPath, `${[headerWithoutCwd, ...rest].map((record) => JSON.stringify(record)).join("\n")}\n`);

		const host = createNodeLegacySessionHost({ defaultCwd: "C:\\default", sessionsDirectory: directory });
		const catalog = new LegacyRuntimeSessionCatalog(host);
		const sessions = await catalog.listSessions("C:\\workspace", directory);
		// 头部缺 cwd 不能被当成别人的文件：否则旧版本写的会话在列表里整条消失。
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({ id: "legacy-session", cwd: "C:\\workspace" });
	});

	it("accepts a session header that starts with a byte order mark", async () => {
		const directory = createTemporaryDirectory(temporaryDirectories);
		const sessionPath = join(directory, "bom.jsonl");
		const [header, ...rest] = legacySessionRecords();
		writeFileSync(sessionPath, `\uFEFF${[header, ...rest].map((record) => JSON.stringify(record)).join("\n")}\n`);

		const host = createNodeLegacySessionHost({ defaultCwd: directory, sessionsDirectory: directory });
		const sessions = await new LegacyRuntimeSessionCatalog(host).listSessions("C:\\workspace", directory);
		expect(sessions).toHaveLength(1);
	});
});

function createTemporaryDirectory(collection: string[]): string {
	const directory = mkdtempSync(join(tmpdir(), "astravia-legacy-format-"));
	collection.push(directory);
	return directory;
}

function legacySessionRecords(): readonly object[] {
	return [
		{
			type: "session",
			version: 3,
			id: "legacy-session",
			timestamp: "2026-01-01T00:00:00.000Z",
			cwd: "C:\\workspace",
			parentSession: "parent.jsonl",
			parentEntryId: "parent-entry",
		},
		{
			type: "message",
			id: "user",
			parentId: null,
			timestamp: "1970-01-01T00:00:00.100Z",
			message: userMessage("first prompt", 100),
		},
		{
			type: "message",
			id: "assistant",
			parentId: "user",
			timestamp: "1970-01-01T00:00:00.200Z",
			message: { role: "assistant", content: "final answer", timestamp: 200 },
		},
		{
			type: "message",
			id: "image-only",
			parentId: "assistant",
			timestamp: "1970-01-01T00:00:00.300Z",
			message: { role: "user", content: [], timestamp: 300 },
		},
	];
}

function userMessage(content: string, timestamp = 1): UserMessage {
	return { role: "user", content, timestamp };
}
