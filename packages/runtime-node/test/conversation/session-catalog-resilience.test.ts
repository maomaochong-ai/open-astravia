import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageAppendedEvent, TurnStartedEvent } from "@astravia/runtime-core/kernel";
import { afterEach, describe, expect, it } from "vitest";
import { FileConversationRepository, FileConversationRuntimeSessionCatalog } from "../../src/conversation/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("runtime session catalog listing", () => {
	it("keeps a session listed when its file is momentarily unreadable", async () => {
		const { catalog, cwd, rootDir, sessionPath } = await seedSession("keep-listed");

		expect(await catalog.listSessions(cwd, rootDir)).toHaveLength(1);

		// 另一写入者替换/追写文件时，这一趟可能读到半份内容。不能因此把会话从列表里摘掉，
		// 否则侧栏里的会话会在对话进行中凭空消失，下一次重列又冒出来。
		await writeFile(sessionPath, '{"recordType":"conversation.header","schemaVersion":', "utf8");

		const sessions = await catalog.listSessions(cwd, rootDir);
		expect(sessions.map(({ id }) => id)).toEqual(["keep-listed"]);
	});

	it("drops a session once its file is gone", async () => {
		const { catalog, cwd, rootDir, sessionPath } = await seedSession("deleted-later");

		expect(await catalog.listSessions(cwd, rootDir)).toHaveLength(1);
		await rm(sessionPath, { force: true });

		expect(await catalog.listSessions(cwd, rootDir)).toEqual([]);
	});

	it("re-reads a file that changed instead of serving the cached projection", async () => {
		const { catalog, cwd, rootDir, repository, sessionPath } = await seedSession("growing");

		expect((await catalog.listSessions(cwd, rootDir))[0]?.lastMessagePreview).toBe("hello there");

		await repository.append("growing", 2, [assistantMessage("growing", "second reply", 300)]);
		await repository.close();

		const [session] = await catalog.listSessions(cwd, rootDir);
		expect(session?.lastMessagePreview).toBe("second reply");
		expect(session?.modifiedAt).toBe(300);
		expect(session?.path).toBe(sessionPath);
	});
});

async function seedSession(sessionId: string): Promise<{
	readonly catalog: FileConversationRuntimeSessionCatalog;
	readonly cwd: string;
	readonly rootDir: string;
	readonly repository: FileConversationRepository;
	readonly sessionPath: string;
}> {
	const rootDir = await mkdtemp(join(tmpdir(), "astravia-session-catalog-"));
	temporaryRoots.push(rootDir);
	const cwd = join(rootDir, "workspace");
	const repository = new FileConversationRepository({ rootDir });
	await repository.create({ sessionId, createdAt: 10, cwd });
	await repository.append(sessionId, 0, [started(sessionId, 100), userMessage(sessionId, "hello there", 110)]);
	const sessionPath = repository.resolveConversationPath(sessionId);
	return {
		catalog: new FileConversationRuntimeSessionCatalog(),
		cwd,
		rootDir,
		repository,
		sessionPath,
	};
}

function started(sessionId: string, timestamp: number): TurnStartedEvent {
	return {
		type: "turn.started",
		sessionId,
		turnId: "turn-1",
		snapshotId: "snapshot-1",
		timestamp,
	};
}

function userMessage(sessionId: string, text: string, timestamp: number): MessageAppendedEvent {
	return {
		type: "message.appended",
		sessionId,
		turnId: "turn-1",
		message: { role: "user", content: text, timestamp },
		timestamp,
	};
}

function assistantMessage(sessionId: string, text: string, timestamp: number): MessageAppendedEvent {
	return {
		type: "message.appended",
		sessionId,
		turnId: "turn-1",
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
			timestamp,
		},
		timestamp,
	};
}
