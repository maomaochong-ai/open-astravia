import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileConversationRepository } from "../../src/conversation/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function createRepository(): Promise<{
	readonly repository: FileConversationRepository;
	readonly rootDir: string;
}> {
	const rootDir = await mkdtemp(join(tmpdir(), "vetta-turn-failed-"));
	temporaryRoots.push(rootDir);
	return { repository: new FileConversationRepository({ rootDir }), rootDir };
}

describe("turn.failed document projection", () => {
	it("keeps the conversation readable after a failed turn is followed by a new message", async () => {
		const { repository, rootDir } = await createRepository();
		await repository.create({ sessionId: "session-1", createdAt: 1 });
		await repository.append("session-1", 0, [
			{ type: "turn.started", sessionId: "session-1", turnId: "turn-1", snapshotId: "snapshot-1", timestamp: 100 },
			{
				type: "message.appended",
				sessionId: "session-1",
				turnId: "turn-1",
				message: { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 101 },
				timestamp: 101,
			},
			{
				type: "turn.failed",
				sessionId: "session-1",
				turnId: "turn-1",
				error: { code: "AI_TRANSPORT_FAILED", message: "terminated", retryable: false, origin: "provider" },
				timestamp: 102,
			},
		]);
		await repository.append("session-1", 3, [
			{ type: "turn.started", sessionId: "session-1", turnId: "turn-2", snapshotId: "snapshot-2", timestamp: 200 },
			{
				type: "message.appended",
				sessionId: "session-1",
				turnId: "turn-2",
				message: { role: "user", content: [{ type: "text", text: "retry" }], timestamp: 201 },
				timestamp: 201,
			},
		]);
		await repository.close();

		const reopened = new FileConversationRepository({ rootDir });
		const conversation = await reopened.load("session-1");
		expect(conversation.version).toBe(5);
		await reopened.close();
	});
});
