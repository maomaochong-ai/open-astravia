import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type Clock,
	type EventSink,
	type IdGenerator,
	KERNEL_ERROR_CODES,
	type KernelEvent,
	type RuntimeSnapshotProvider,
	type TurnEngineEvent,
	type TurnEnginePort,
	TurnPipeline,
} from "../../../runtime-core/src/kernel/index.js";
import { FileConversationRepository } from "../../src/conversation/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function createRepository(): Promise<{
	readonly repository: FileConversationRepository;
	readonly rootDir: string;
}> {
	const rootDir = await mkdtemp(join(tmpdir(), "astravia-turn-recovery-"));
	temporaryRoots.push(rootDir);
	return {
		repository: new FileConversationRepository({ rootDir }),
		rootDir,
	};
}

function createPipeline(repository: FileConversationRepository): TurnPipeline {
	const snapshotProvider: RuntimeSnapshotProvider = {
		async acquire(): Promise<never> {
			throw new Error("Recovery must not acquire a runtime snapshot");
		},
	};
	const turnEngine: TurnEnginePort = {
		execute(): AsyncIterable<TurnEngineEvent> {
			throw new Error("Recovery must not execute a turn");
		},
	};
	const eventSink: EventSink = {
		async publish(_event: KernelEvent): Promise<void> {},
	};
	const clock: Clock = { now: () => 200 };
	const idGenerator: IdGenerator = { next: () => "unused-turn-id" };
	return new TurnPipeline({ repository, snapshotProvider, turnEngine, eventSink, clock, idGenerator });
}

async function seedIncompleteTurn(repository: FileConversationRepository): Promise<void> {
	await repository.create({ sessionId: "session-1", createdAt: 1 });
	await repository.append("session-1", 0, [
		{
			type: "turn.started",
			sessionId: "session-1",
			turnId: "turn-1",
			snapshotId: "snapshot-1",
			timestamp: 100,
		},
	]);
}

describe("TurnPipeline recovery with FileConversationRepository", () => {
	it("persists one interrupted terminal and remains idempotent after reopening", async () => {
		const { repository, rootDir } = await createRepository();
		await seedIncompleteTurn(repository);

		await createPipeline(repository).resumeSession("session-1");
		await repository.close();

		const reopened = new FileConversationRepository({ rootDir });
		await createPipeline(reopened).resumeSession("session-1");
		const conversation = await reopened.load("session-1");

		expect(conversation.version).toBe(2);
		expect(conversation.events.at(-1)).toMatchObject({
			type: "turn.failed",
			turnId: "turn-1",
			error: { code: KERNEL_ERROR_CODES.TURN_INTERRUPTED },
		});
		await reopened.close();
	});

	// 两个写入者同时恢复同一 Turn 时，落败的一方会看到终态已由对方写好：
	// 那是一个正常结果，不是需要弹给人的失败，否则并发恢复会变成用户可见的错误。
	it("lets the losing concurrent recovery finish without an error", async () => {
		const { repository } = await createRepository();
		await seedIncompleteTurn(repository);

		const results = await Promise.allSettled([
			createPipeline(repository).resumeSession("session-1"),
			createPipeline(repository).resumeSession("session-1"),
		]);

		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
		const conversation = await repository.load("session-1");
		expect(conversation.version).toBe(2);
		expect(conversation.events.filter((event) => event.type === "turn.failed")).toHaveLength(1);
		await repository.close();
	});

	// 跨进程双写入者留下的真实形状：终态已经写好，随后又追写这个 Turn 的消息。
	// 旧策略把这种文件判死，用户只能删会话重建；它实际上已经收敛，应当可以直接继续。
	it("opens a file whose finished turn was appended to by another writer", async () => {
		const { repository } = await createRepository();
		await repository.create({ sessionId: "session-1", createdAt: 1 });
		await repository.append("session-1", 0, [
			{ type: "turn.started", sessionId: "session-1", turnId: "turn-1", snapshotId: "snapshot-1", timestamp: 100 },
			{
				type: "turn.failed",
				sessionId: "session-1",
				turnId: "turn-1",
				error: { code: KERNEL_ERROR_CODES.TURN_INTERRUPTED, message: "interrupted" },
				timestamp: 110,
			},
			{
				type: "message.appended",
				sessionId: "session-1",
				turnId: "turn-1",
				messageId: "message-1",
				message: { role: "user", content: "late tail", timestamp: 120 },
				timestamp: 120,
			},
		]);

		await expect(createPipeline(repository).resumeSession("session-1")).resolves.toBeUndefined();
		const conversation = await repository.load("session-1");
		// 残留不再触发第二条终态，也不改变会话可执行性。
		expect(conversation.version).toBe(3);
		expect(conversation.events.filter((event) => event.type === "turn.failed")).toHaveLength(1);
		await repository.close();
	});
});
