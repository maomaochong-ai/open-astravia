import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageAppendedEvent, TurnCompletedEvent, TurnStartedEvent } from "@astravia/runtime-core/kernel";
import { afterEach, describe, expect, it } from "vitest";
import { FileConversationRepository } from "../../src/conversation/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function createRepository(): Promise<{ repository: FileConversationRepository; rootDir: string }> {
	const rootDir = await mkdtemp(join(tmpdir(), "astravia-conversation-identity-"));
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

function completed(sessionId: string, turnId: string): TurnCompletedEvent {
	return { type: "turn.completed", sessionId, turnId, stopReason: "stop", timestamp: 3 };
}

function turn(sessionId: string, turnId: string, text: string) {
	return [started(sessionId, turnId), message(sessionId, turnId, text), completed(sessionId, turnId)];
}

describe("FileConversationRepository parse cache identity", () => {
	// 每写一条事件都会先读一遍会话文件；长会话整份重读会把解析压在 Electron 主进程上。
	it("reuses the parsed result without opening the file again while inode, size and mtime are unchanged", async () => {
		const { repository } = await createRepository();
		const sessionId = "identity-session";
		await repository.create({ sessionId, createdAt: 100 });
		await repository.append(sessionId, 0, turn(sessionId, "turn-1", "stable"));
		expect((await repository.load(sessionId)).version).toBe(3);

		const path = repository.resolveConversationPath(sessionId);
		// 去掉读权限但保留文件身份：命中缓存就不会再打开文件（打开会 EACCES），
		// 若实现退化成每次整份重读，这里会失败。
		await chmod(path, 0o000);
		try {
			const conversation = await repository.load(sessionId);
			expect(conversation.version).toBe(3);
			expect(conversation.messages[0]).toMatchObject({ role: "user", content: "stable" });
		} finally {
			await chmod(path, 0o644);
		}
	});

	// 自己追加的记录直接并入缓存：下一轮读取不该再打开文件，增量结果要与冷启动读盘一致。
	it("parses only the appended bytes and still projects them onto the cached document", async () => {
		const { repository, rootDir } = await createRepository();
		const sessionId = "append-only-session";
		await repository.create({ sessionId, createdAt: 100 });
		await repository.append(sessionId, 0, turn(sessionId, "turn-1", "first"));
		const first = await repository.load(sessionId);
		expect(first.version).toBe(3);

		await repository.append(sessionId, first.version, turn(sessionId, "turn-2", "second"));

		// 追加后缓存身份已更新：这里去掉读权限，命中缓存就不必再开文件（打开会 EACCES）。
		const path = repository.resolveConversationPath(sessionId);
		await chmod(path, 0o000);
		try {
			const after = await repository.load(sessionId);
			expect(after.version).toBe(6);
			expect(after.messages.map((item) => item.content)).toEqual(["first", "second"]);
		} finally {
			await chmod(path, 0o644);
		}

		// 冷启动整份重读必须得到同一份投影，否则增量路径与读盘规则已经分叉。
		const cold = new FileConversationRepository({ rootDir });
		const fresh = await cold.load(sessionId);
		expect(fresh.version).toBe(6);
		expect(fresh.messages.map((item) => item.content)).toEqual(["first", "second"]);
		await cold.close();
	});

	it("falls back to a full reparse once the file changes, and stays consistent with a cold repository", async () => {
		const { repository, rootDir } = await createRepository();
		const sessionId = "replaced-session";
		await repository.create({ sessionId, createdAt: 100 });
		await repository.append(sessionId, 0, turn(sessionId, "turn-1", "warm"));
		expect((await repository.load(sessionId)).version).toBe(3);

		// 内容与长度都变：文件身份变化，必须走整份重解析。
		const path = repository.resolveConversationPath(sessionId);
		const text = await readFile(path, "utf8");
		await writeFile(path, text.replace('"warm"', '"cooled-down"'), "utf8");

		const warmConversation = await repository.load(sessionId);
		expect(warmConversation.messages[0]).toMatchObject({ role: "user", content: "cooled-down" });

		const cold = new FileConversationRepository({ rootDir });
		expect(warmConversation).toEqual(await cold.load(sessionId));
		await cold.close();
	});
});
