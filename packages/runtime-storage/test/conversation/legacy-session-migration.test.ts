import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	CONVERSATION_STORAGE_ERROR_CODES,
	ConversationStorageError,
	FileConversationRepository,
	type LegacySessionImportEntryNormalizer,
	LegacySessionImportError,
	migrateLegacySessionToV2,
} from "../../src/conversation/index.js";

const temporaryRoots = new Set<string>();
const preserveLegacyEntry: LegacySessionImportEntryNormalizer = (entry) => entry;

afterEach(async () => {
	await Promise.all([...temporaryRoots].map((root) => rm(root, { force: true, recursive: true })));
	temporaryRoots.clear();
});

describe("legacy session migration", () => {
	it("publishes a validated V2 conversation without modifying the source", async () => {
		const root = await createTemporaryRoot();
		const sourcePath = join(root, "legacy.jsonl");
		const targetRootDir = join(root, "v2");
		const sourceContent = legacyJsonLines([
			{
				...legacyHeader("legacy-source"),
				parentSession: "C:/legacy-parent.jsonl",
				parentEntryId: "parent-entry",
			},
			legacyMessage("user-1", null, userMessage("legacy question", 1)),
			legacyMessage("assistant-1", "user-1", assistantMessage("legacy answer", 2)),
			{
				type: "session_info",
				id: "session-name",
				parentId: "assistant-1",
				timestamp: "2026-01-01T00:00:03.000Z",
				name: "Imported session",
			},
		]);
		await writeFile(sourcePath, sourceContent, "utf8");

		const result = await migrateLegacySessionToV2({
			sourcePath,
			targetRootDir,
			targetSessionId: "v2-target",
			entryNormalizer: preserveLegacyEntry,
		});

		expect(result).toMatchObject({
			sourcePath,
			sourceSessionId: "legacy-source",
			sourceVersion: 3,
			targetSessionId: "v2-target",
		});
		expect(await readFile(sourcePath, "utf8")).toBe(sourceContent);
		const targetRecords = (await readFile(result.targetPath, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as unknown);
		expect(targetRecords).toEqual([
			expect.objectContaining({
				recordType: "conversation.header",
				schemaVersion: 2,
				sessionId: "v2-target",
				cwd: "C:/legacy-workspace",
				parentSessionPath: "C:/legacy-parent.jsonl",
				parentEntryId: "parent-entry",
			}),
			expect.objectContaining({
				recordType: "conversation.import.seed",
				schemaVersion: 2,
				source: {
					format: "coding-agent-jsonl",
					path: sourcePath,
					sessionId: "legacy-source",
					version: 3,
				},
			}),
		]);

		const repository = new FileConversationRepository({ rootDir: targetRootDir });
		const document = await repository.readDocument("v2-target");
		expect(document.identity).toEqual({
			sessionId: "v2-target",
			createdAt: new Date("2026-01-01T00:00:00.000Z").getTime(),
			cwd: "C:/legacy-workspace",
			parentSessionPath: "C:/legacy-parent.jsonl",
			parentEntryId: "parent-entry",
		});
		expect(document.entries.map(({ id }) => id)).toEqual(["user-1", "assistant-1", "session-name"]);
		expect(document.activeLeafId).toBe("session-name");
		expect(document.name).toBe("Imported session");
		await expect(repository.load("v2-target")).resolves.toMatchObject({
			sessionId: "v2-target",
			version: 0,
			messages: [userMessage("legacy question", 1), assistantMessage("legacy answer", 2)],
		});

		await repository.append("v2-target", 0, [
			{
				type: "turn.started",
				sessionId: "v2-target",
				turnId: "turn-1",
				snapshotId: "snapshot-1",
				timestamp: 10,
			},
			{
				type: "message.appended",
				sessionId: "v2-target",
				turnId: "turn-1",
				message: userMessage("continued question", 11),
				timestamp: 11,
			},
			{
				type: "turn.completed",
				sessionId: "v2-target",
				turnId: "turn-1",
				stopReason: "stop",
				timestamp: 12,
			},
		]);
		await expect(repository.load("v2-target")).resolves.toMatchObject({
			version: 3,
			messages: [
				userMessage("legacy question", 1),
				assistantMessage("legacy answer", 2),
				userMessage("continued question", 11),
			],
		});
		await repository.close();
	});

	it("persists mixed Import Seed and V2 Event history mutations across reopen", async () => {
		const fixture = await createMixedTreeFixture();
		await appendTurn(fixture.repository, "mixed-target", 0, "turn-1", "continued question", "continued answer");

		const initial = await fixture.repository.readDocument("mixed-target");
		const oldBranch = await fixture.repository.execute("mixed-target", initial.revision, {
			type: "branch.select",
			entryId: "user-old",
		});
		expect(oldBranch.leafId).toBe("assistant-old");
		await fixture.repository.close();

		let reopened = new FileConversationRepository({ rootDir: fixture.targetRootDir });
		expect((await reopened.load("mixed-target")).messages.map(messageText)).toEqual([
			"root question",
			"root answer",
			"old question",
			"old answer",
		]);
		const selected = await reopened.execute("mixed-target", oldBranch.document.revision, {
			type: "branch.select",
			entryId: "user-new",
		});
		expect(selected.leafId).toBe("event-3");

		const deleted = await reopened.execute("mixed-target", selected.document.revision, {
			type: "message.delete",
			entryId: "assistant-root",
		});
		expect(deleted.document.entries.find(({ id }) => id === "user-old")?.parentId).toBe("user-root");
		expect(deleted.document.entries.find(({ id }) => id === "user-new")?.parentId).toBe("user-root");
		expect(deleted.document.entries.find(({ id }) => id === "branch-summary")).toMatchObject({
			fromId: "user-root",
		});
		expect(deleted.document.entries.find(({ id }) => id === "compaction")).toMatchObject({
			firstKeptEntryId: "user-new",
		});

		const replaced = await reopened.execute("mixed-target", deleted.document.revision, {
			type: "user_turn.replace",
			entryId: "event-2",
		});
		expect(replaced.leafId).toBe("tail-user");
		await reopened.close();

		reopened = new FileConversationRepository({ rootDir: fixture.targetRootDir });
		const restored = await reopened.readDocument("mixed-target");
		expect(restored.entries.map(({ id }) => id)).not.toEqual(
			expect.arrayContaining(["assistant-root", "event-2", "event-3"]),
		);
		expect(restored.entries.find(({ id }) => id === "branch-summary")).toMatchObject({ fromId: "user-root" });
		expect(restored.activeLeafId).toBe("tail-user");
		await appendTurn(reopened, "mixed-target", 4, "turn-2", "replacement question", "replacement answer");
		const continued = await reopened.readDocument("mixed-target");
		expect(continued.entries.find(({ id }) => id === "event-6")?.parentId).toBe("tail-user");
		expect(continued.entries.find(({ id }) => id === "event-7")?.parentId).toBe("event-6");
		expect(await readFile(fixture.sourcePath, "utf8")).toBe(fixture.sourceContent);
		await reopened.close();
	});

	it("forks mixed Seed and Event branches into independently recoverable conversations", async () => {
		const fixture = await createMixedTreeFixture();
		await appendTurn(fixture.repository, "mixed-target", 0, "turn-1", "continued question", "continued answer");

		const mixedFork = await fixture.repository.fork("mixed-target", "event-2");
		const mixedDocument = await fixture.repository.readDocument(mixedFork.sessionId);
		expect(mixedFork.text).toBe("continued question");
		expect(mixedDocument.identity).toMatchObject({
			parentSessionPath: fixture.repository.resolveConversationPath("mixed-target"),
			parentEntryId: "event-2",
		});
		expect(mixedDocument.entries.map(({ id }) => id)).toEqual([
			"user-root",
			"assistant-root",
			"user-new",
			"assistant-new",
			"branch-summary",
			"compaction",
			"tail-user",
			"event-2",
			"event-3",
		]);
		expect(mixedDocument.activeLeafId).toBe("event-3");
		expect((await fixture.repository.load(mixedFork.sessionId)).version).toBe(4);

		const seedFork = await fixture.repository.fork("mixed-target", "user-old");
		const seedDocument = await fixture.repository.readDocument(seedFork.sessionId);
		expect(seedFork.text).toBe("old question");
		expect(seedDocument.entries.map(({ id }) => id)).toEqual([
			"user-root",
			"assistant-root",
			"user-old",
			"assistant-old",
		]);
		expect(seedDocument.activeLeafId).toBe("assistant-old");
		expect((await fixture.repository.load(seedFork.sessionId)).version).toBe(0);
		expect(await readFile(fixture.sourcePath, "utf8")).toBe(fixture.sourceContent);
		await fixture.repository.close();

		const reopened = new FileConversationRepository({ rootDir: fixture.targetRootDir });
		await expect(reopened.readDocument(mixedFork.sessionId)).resolves.toMatchObject({ activeLeafId: "event-3" });
		await expect(reopened.readDocument(seedFork.sessionId)).resolves.toMatchObject({ activeLeafId: "assistant-old" });
		await reopened.close();
	});

	it("fails closed when the target already exists and keeps both files unchanged", async () => {
		const root = await createTemporaryRoot();
		const sourcePath = join(root, "legacy.jsonl");
		const targetRootDir = join(root, "v2");
		const sourceContent = legacyJsonLines([
			legacyHeader("legacy-source"),
			legacyMessage("user-1", null, userMessage("hello", 1)),
		]);
		await writeFile(sourcePath, sourceContent, "utf8");
		const first = await migrateLegacySessionToV2({
			sourcePath,
			targetRootDir,
			targetSessionId: "stable-target",
			entryNormalizer: preserveLegacyEntry,
		});
		const targetContent = await readFile(first.targetPath, "utf8");

		await expect(
			migrateLegacySessionToV2({
				sourcePath,
				targetRootDir,
				targetSessionId: "stable-target",
				entryNormalizer: preserveLegacyEntry,
			}),
		).rejects.toMatchObject({
			code: CONVERSATION_STORAGE_ERROR_CODES.ALREADY_EXISTS,
		});
		expect(await readFile(sourcePath, "utf8")).toBe(sourceContent);
		expect(await readFile(first.targetPath, "utf8")).toBe(targetContent);
	});

	it("reuses only an identical deterministic target", async () => {
		const root = await createTemporaryRoot();
		const sourcePath = join(root, "legacy.jsonl");
		const targetRootDir = join(root, "v2");
		const sourceContent = legacyJsonLines([
			legacyHeader("legacy-source"),
			legacyMessage("user-1", null, userMessage("hello", 1)),
		]);
		await writeFile(sourcePath, sourceContent, "utf8");
		const first = await migrateLegacySessionToV2({
			sourcePath,
			targetRootDir,
			targetSessionId: "stable-target",
			reuseIdenticalTarget: true,
			entryNormalizer: preserveLegacyEntry,
		});

		const reused = await migrateLegacySessionToV2({
			sourcePath,
			targetRootDir,
			targetSessionId: "stable-target",
			reuseIdenticalTarget: true,
			entryNormalizer: preserveLegacyEntry,
		});
		expect(first.created).toBe(true);
		expect(reused.created).toBe(false);

		await writeFile(
			sourcePath,
			legacyJsonLines([legacyHeader("legacy-source"), legacyMessage("user-1", null, userMessage("changed", 1))]),
			"utf8",
		);
		await expect(
			migrateLegacySessionToV2({
				sourcePath,
				targetRootDir,
				targetSessionId: "stable-target",
				reuseIdenticalTarget: true,
				entryNormalizer: preserveLegacyEntry,
			}),
		).rejects.toMatchObject({ code: CONVERSATION_STORAGE_ERROR_CODES.ALREADY_EXISTS });
	});

	it("reuses a deterministic target after native events were appended", async () => {
		const root = await createTemporaryRoot();
		const sourcePath = join(root, "legacy.jsonl");
		const targetRootDir = join(root, "v2");
		const sourceContent = legacyJsonLines([
			legacyHeader("legacy-source"),
			legacyMessage("user-1", null, userMessage("hello", 1)),
		]);
		await writeFile(sourcePath, sourceContent, "utf8");
		const first = await migrateLegacySessionToV2({
			sourcePath,
			targetRootDir,
			targetSessionId: "stable-target",
			reuseIdenticalTarget: true,
			entryNormalizer: preserveLegacyEntry,
		});
		const repository = new FileConversationRepository({ rootDir: targetRootDir });
		await repository.append("stable-target", 0, [
			{
				type: "turn.started",
				sessionId: "stable-target",
				turnId: "turn-1",
				snapshotId: "snapshot-1",
				timestamp: 10,
			},
			{
				type: "message.appended",
				sessionId: "stable-target",
				turnId: "turn-1",
				message: userMessage("continued question", 11),
				timestamp: 11,
			},
			{
				type: "turn.completed",
				sessionId: "stable-target",
				turnId: "turn-1",
				stopReason: "stop",
				timestamp: 12,
			},
		]);
		await repository.close();
		const continuedContent = await readFile(first.targetPath, "utf8");

		const reused = await migrateLegacySessionToV2({
			sourcePath,
			targetRootDir,
			targetSessionId: "stable-target",
			reuseIdenticalTarget: true,
			entryNormalizer: preserveLegacyEntry,
		});

		expect(reused.created).toBe(false);
		expect(reused.document).toMatchObject({ journalVersion: 3, revision: 2 });
		expect(reused.document.entries).toContainEqual(
			expect.objectContaining({ message: userMessage("continued question", 11) }),
		);
		expect(await readFile(first.targetPath, "utf8")).toBe(continuedContent);
	});

	it("rejects entries outside the V2 schema before publishing a target", async () => {
		const root = await createTemporaryRoot();
		const sourcePath = join(root, "legacy.jsonl");
		const targetRootDir = join(root, "v2");
		await writeFile(
			sourcePath,
			legacyJsonLines([
				legacyHeader("unsupported-source"),
				legacyMessage("assistant-1", null, {
					role: "assistant",
					content: "extension-specific message",
					timestamp: 1,
				}),
			]),
			"utf8",
		);

		const migration = migrateLegacySessionToV2({
			sourcePath,
			targetRootDir,
			targetSessionId: "rejected-target",
			entryNormalizer: preserveLegacyEntry,
		});
		await expect(migration).rejects.toBeInstanceOf(ConversationStorageError);
		await expect(migration).rejects.toMatchObject({
			code: CONVERSATION_STORAGE_ERROR_CODES.CORRUPT,
		});
		const encodedTarget = Buffer.from("rejected-target", "utf8").toString("base64url");
		await expect(stat(join(targetRootDir, `${encodedTarget}.conversation.jsonl`))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it.each([
		{
			name: "malformed JSON",
			content: `${JSON.stringify(legacyHeader("malformed-source"))}\n{broken}\n`,
			issueCode: "malformed-json",
		},
		{
			name: "an unknown record",
			content: legacyJsonLines([
				legacyHeader("unknown-source"),
				{
					type: "future_entry",
					id: "future-1",
					parentId: null,
					timestamp: "2026-01-01T00:00:01.000Z",
					payload: "must not be dropped",
				},
			]),
			issueCode: "unsupported-record",
		},
		{
			name: "a broken parent reference",
			content: legacyJsonLines([
				legacyHeader("broken-parent-source"),
				legacyMessage("user-1", "missing", userMessage("hello", 1)),
			]),
			issueCode: "broken-parent-reference",
		},
	])("fails closed for $name before creating the target directory", async ({ content, issueCode }) => {
		const root = await createTemporaryRoot();
		const sourcePath = join(root, "legacy.jsonl");
		const targetRootDir = join(root, "v2");
		await writeFile(sourcePath, content, "utf8");

		const migration = migrateLegacySessionToV2({
			sourcePath,
			targetRootDir,
			targetSessionId: "strict-target",
			entryNormalizer: preserveLegacyEntry,
		});
		await expect(migration).rejects.toBeInstanceOf(LegacySessionImportError);
		await expect(migration).rejects.toMatchObject({
			analysis: { status: "not-representable", issues: [expect.objectContaining({ code: issueCode })] },
		});
		await expect(stat(targetRootDir)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readFile(sourcePath, "utf8")).resolves.toBe(content);
	});
});

async function createTemporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-legacy-migration-"));
	temporaryRoots.add(root);
	return root;
}

async function createMixedTreeFixture() {
	const root = await createTemporaryRoot();
	const sourcePath = join(root, "mixed-legacy.jsonl");
	const targetRootDir = join(root, "v2");
	const sourceContent = legacyJsonLines([
		legacyHeader("mixed-source"),
		legacyTreeEntry("message", "user-root", null, 1, { message: userMessage("root question", 1) }),
		legacyTreeEntry("message", "assistant-root", "user-root", 2, {
			message: assistantMessage("root answer", 2),
		}),
		legacyTreeEntry("message", "user-old", "assistant-root", 3, { message: userMessage("old question", 3) }),
		legacyTreeEntry("message", "assistant-old", "user-old", 4, { message: assistantMessage("old answer", 4) }),
		legacyTreeEntry("message", "user-new", "assistant-root", 5, { message: userMessage("new question", 5) }),
		legacyTreeEntry("message", "assistant-new", "user-new", 6, { message: assistantMessage("new answer", 6) }),
		legacyTreeEntry("branch_summary", "branch-summary", "assistant-new", 7, {
			fromId: "assistant-root",
			summary: "branch summary",
		}),
		legacyTreeEntry("compaction", "compaction", "branch-summary", 8, {
			summary: "compaction summary",
			firstKeptEntryId: "user-new",
			tokensBefore: 100,
		}),
		legacyTreeEntry("message", "tail-user", "compaction", 9, { message: userMessage("tail question", 9) }),
	]);
	await writeFile(sourcePath, sourceContent, "utf8");
	await migrateLegacySessionToV2({
		sourcePath,
		targetRootDir,
		targetSessionId: "mixed-target",
		entryNormalizer: preserveLegacyEntry,
	});
	return {
		repository: new FileConversationRepository({ rootDir: targetRootDir }),
		root,
		sourceContent,
		sourcePath,
		targetRootDir,
	};
}

async function appendTurn(
	repository: FileConversationRepository,
	sessionId: string,
	expectedVersion: number,
	turnId: string,
	question: string,
	answer: string,
): Promise<void> {
	await repository.append(sessionId, expectedVersion, [
		{ type: "turn.started", sessionId, turnId, snapshotId: "snapshot-1", timestamp: 10 },
		{ type: "message.appended", sessionId, turnId, message: userMessage(question, 11), timestamp: 11 },
		{ type: "message.appended", sessionId, turnId, message: assistantMessage(answer, 12), timestamp: 12 },
		{ type: "turn.completed", sessionId, turnId, stopReason: "stop", timestamp: 13 },
	]);
}

function legacyTreeEntry(
	type: string,
	id: string,
	parentId: string | null,
	second: number,
	fields: Readonly<Record<string, unknown>>,
) {
	return {
		type,
		id,
		parentId,
		timestamp: `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`,
		...fields,
	};
}

function legacyHeader(sessionId: string) {
	return {
		type: "session",
		version: 3,
		id: sessionId,
		timestamp: "2026-01-01T00:00:00.000Z",
		cwd: "C:/legacy-workspace",
	};
}

function legacyMessage(id: string, parentId: string | null, message: unknown) {
	return {
		type: "message",
		id,
		parentId,
		timestamp: "2026-01-01T00:00:01.000Z",
		message,
	};
}

function userMessage(content: string, timestamp: number) {
	return { role: "user" as const, content, timestamp };
}

function assistantMessage(text: string, timestamp: number) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		api: "openai-responses",
		provider: "openai",
		model: "test-model",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		timestamp,
	};
}

function legacyJsonLines(records: readonly unknown[]): string {
	return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function messageText(message: { readonly content: unknown }): string {
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content
		.flatMap((item) => {
			if (typeof item !== "object" || item === null || Reflect.get(item, "type") !== "text") return [];
			const text = Reflect.get(item, "text");
			return typeof text === "string" ? [text] : [];
		})
		.join("");
}
