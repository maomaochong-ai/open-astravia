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
import { CONVERSATION_STORAGE_ERROR_CODES, FileConversationRepository } from "../../src/conversation/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function createRepository(): Promise<{
	readonly repository: FileConversationRepository;
	readonly rootDir: string;
}> {
	const rootDir = await mkdtemp(join(tmpdir(), "vetta-turn-recovery-"));
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

	it("allows only one concurrent recovery writer for the same version", async () => {
		const { repository } = await createRepository();
		await seedIncompleteTurn(repository);

		const results = await Promise.allSettled([
			createPipeline(repository).resumeSession("session-1"),
			createPipeline(repository).resumeSession("session-1"),
		]);

		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
		expect(rejected?.reason).toMatchObject({ code: CONVERSATION_STORAGE_ERROR_CODES.VERSION_CONFLICT });
		const conversation = await repository.load("session-1");
		expect(conversation.version).toBe(2);
		expect(conversation.events.filter((event) => event.type === "turn.failed")).toHaveLength(1);
		await repository.close();
	});
});
