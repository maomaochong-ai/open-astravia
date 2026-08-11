import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserMessage } from "@vetta/ai";
import { afterEach, describe, expect, it } from "vitest";
import { LegacyRuntimeSessionCatalog } from "../../src/sessions/legacy/catalog.js";
import { LegacyRuntimeSessionFileHistoryReader } from "../../src/sessions/legacy/history-reader.js";
import { acquireLegacySessionFormatLease } from "../../src/sessions/legacy/lease.js";

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

		const catalog = new LegacyRuntimeSessionCatalog();
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

		const history = new LegacyRuntimeSessionFileHistoryReader().read(sessionPath).history;
		expect(history.filter(({ type }) => type === "message")).toHaveLength(3);
	});

	it("enforces the single-writer lease and reclaims it after release", () => {
		const directory = createTemporaryDirectory(temporaryDirectories);
		const sessionPath = join(directory, "lease.jsonl");
		writeFileSync(sessionPath, "");

		const first = acquireLegacySessionFormatLease(sessionPath);
		expect(first.kind).toBe("acquired");
		const second = acquireLegacySessionFormatLease(sessionPath);
		expect(second.kind).toBe("locked");
		if (first.kind !== "acquired") throw new Error("Expected the first lease to be acquired");
		first.lease.release();
		const third = acquireLegacySessionFormatLease(sessionPath);
		expect(third.kind).toBe("acquired");
		if (third.kind === "acquired") third.lease.release();
	});
});

function createTemporaryDirectory(collection: string[]): string {
	const directory = mkdtempSync(join(tmpdir(), "vetta-legacy-format-"));
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
