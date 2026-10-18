import { appendFile, mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	MessageAppendedEvent,
	StoredSessionEvent,
	TurnCompletedEvent,
	TurnStartedEvent,
} from "@astravia/runtime-core/kernel";
import { afterEach, describe, expect, it } from "vitest";
import { FileConversationRepository } from "../../src/conversation/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function createRepository(): Promise<{ repository: FileConversationRepository; rootDir: string }> {
	const rootDir = await mkdtemp(join(tmpdir(), "astravia-conversation-incremental-"));
	temporaryRoots.push(rootDir);
	return { repository: new FileConversationRepository({ rootDir }), rootDir };
}

function started(sessionId: string, turnId: string): TurnStartedEvent {
	return { type: "turn.started", sessionId, turnId, snapshotId: "snapshot-1", timestamp: 1 };
}

function message(sessionId: string, turnId: string, text: string): MessageAppendedEvent {
	return {
		type: "message.appended",
		sessionId,
		turnId,
		message: { role: "user", content: text, timestamp: 2 },
		timestamp: 2,
	};
}

function assistant(sessionId: string, turnId: string, text: string): MessageAppendedEvent {
	return {
		type: "message.appended",
		sessionId,
		turnId,
		message: {
			role: "assistant",
			content: [{ type: "text", text }],
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
			stopReason: "stop",
			timestamp: 3,
		},
		timestamp: 3,
	};
}

function completed(sessionId: string, turnId: string): TurnCompletedEvent {
	return { type: "turn.completed", sessionId, turnId, stopReason: "stop", timestamp: 3 };
}

function turn(sessionId: string, turnId: string, prompt: string): StoredSessionEvent[] {
	return [
		started(sessionId, turnId),
		message(sessionId, turnId, prompt),
		assistant(sessionId, turnId, `${prompt} answer`),
		completed(sessionId, turnId),
	];
}

describe("FileConversationRepository incremental reads", () => {
	it("keeps cached reads identical to a full reparse after appends and document commands", async () => {
		const { repository, rootDir } = await createRepository();
		const sessionId = "incremental-session";
		await repository.create({ sessionId, createdAt: 100 });

		// 每批之后都读一次，让缓存逐批前进，覆盖增量路径而不是整份重解析。
		await repository.append(sessionId, 0, turn(sessionId, "turn-1", "first"));
		expect((await repository.load(sessionId)).version).toBe(4);
		await repository.append(sessionId, 4, turn(sessionId, "turn-2", "second"));
		expect((await repository.readDocument(sessionId)).journalVersion).toBe(8);

		const beforeBranch = await repository.readDocument(sessionId);
		const branched = await repository.execute(sessionId, beforeBranch.revision, {
			type: "active_leaf.set",
			entryId: "event-3",
		});
		expect(branched.changed).toBe(true);
		await repository.append(sessionId, 8, turn(sessionId, "turn-3", "third"));
		const beforeRename = await repository.readDocument(sessionId);
		await repository.execute(sessionId, beforeRename.revision, { type: "session.name.set", name: "renamed" });

		const warmDocument = await repository.readDocument(sessionId);
		const warmConversation = await repository.load(sessionId);

		const cold = new FileConversationRepository({ rootDir });
		expect(warmDocument).toEqual(await cold.readDocument(sessionId));
		expect(warmConversation).toEqual(await cold.load(sessionId));
		expect(warmConversation.version).toBe(12);
		expect(warmDocument).toMatchObject({ revision: 8, name: "renamed", journalVersion: 12 });

		await cold.close();
		await repository.close();
	});

	it("re-reads the file when it shrinks instead of trusting the cached offset", async () => {
		const { repository } = await createRepository();
		const sessionId = "shrinking-session";
		await repository.create({ sessionId, createdAt: 100 });
		await repository.append(sessionId, 0, turn(sessionId, "turn-1", "keep"));
		await repository.append(sessionId, 4, turn(sessionId, "turn-2", "drop"));
		expect((await repository.load(sessionId)).version).toBe(8);

		// 文件被还原成只含第一个 turn 的版本（长度回退）。
		const path = repository.resolveConversationPath(sessionId);
		const text = await readFile(path, "utf8");
		const keep = text.split("\n").slice(0, 5).join("\n");
		await writeFile(path, `${keep}\n`, "utf8");
		await truncate(path, Buffer.byteLength(`${keep}\n`, "utf8"));

		const conversation = await repository.load(sessionId);
		expect(conversation.version).toBe(4);
		expect(conversation.messages).toHaveLength(2);
		expect(conversation.messages[0]).toMatchObject({ role: "user", content: "keep" });
	});

	it("reparses when an in-place rewrite keeps the size but changes the mtime", async () => {
		const { repository } = await createRepository();
		const sessionId = "rewritten-session";
		await repository.create({ sessionId, createdAt: 100 });
		await repository.append(sessionId, 0, turn(sessionId, "turn-1", "root"));
		const created = await repository.readDocument(sessionId);
		await repository.execute(sessionId, created.revision, { type: "session.name.set", name: "first" });
		expect((await repository.readDocument(sessionId)).name).toBe("first");

		// 同名长度原地重写：inode 与字节数都不变，只有 mtime 能暴露内容已换。
		const path = repository.resolveConversationPath(sessionId);
		const text = await readFile(path, "utf8");
		const rewritten = text.replace('"first"', '"other"');
		expect(Buffer.byteLength(rewritten, "utf8")).toBe(Buffer.byteLength(text, "utf8"));
		await writeFile(path, rewritten, "utf8");

		expect((await repository.readDocument(sessionId)).name).toBe("other");
	});

	it("rejects a torn trailing record and recovers once the file is repaired", async () => {
		const { repository } = await createRepository();
		const sessionId = "torn-session";
		await repository.create({ sessionId, createdAt: 100 });
		await repository.append(sessionId, 0, turn(sessionId, "turn-1", "intact"));
		expect((await repository.load(sessionId)).version).toBe(4);

		const path = repository.resolveConversationPath(sessionId);
		const intact = await readFile(path, "utf8");
		await appendFile(path, '{"recordType":"conversation.event","schemaVer', "utf8");

		await expect(repository.load(sessionId)).rejects.toThrow(/does not end with a complete record/);

		await writeFile(path, intact, "utf8");
		expect((await repository.load(sessionId)).version).toBe(4);
	});

	it("reports corruption at absolute file lines, not offsets inside the appended chunk", async () => {
		const { repository } = await createRepository();
		const sessionId = "absolute-line-session";
		await repository.create({ sessionId, createdAt: 100 });
		await repository.append(sessionId, 0, turn(sessionId, "turn-1", "first"));
		// 先把缓存推到文件末尾，后面新增的那一段才是“增量”。
		expect((await repository.load(sessionId)).version).toBe(4);

		// 文件里已有 1 行文件头 + 4 行记录，下面这行损坏内容是第 6 行。
		const path = repository.resolveConversationPath(sessionId);
		await appendFile(path, "not-json\n", "utf8");

		await expect(repository.load(sessionId)).rejects.toThrow(/invalid JSON at line 6/);

		await repository.close();
	});
});
