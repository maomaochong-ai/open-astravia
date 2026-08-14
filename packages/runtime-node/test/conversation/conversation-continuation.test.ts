import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, Message, UserMessage } from "@vetta/ai";
import { afterEach, describe, expect, it } from "vitest";
import { FailInterruptedTurnRecoveryPolicy } from "../../../runtime-core/src/kernel/index.js";
import { CONVERSATION_STORAGE_ERROR_CODES, FileConversationRepository } from "../../src/conversation/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("FileConversationRepository continuation", () => {
	it("closes the source turn and continues the same turn from compaction plus kept tail", async () => {
		const { repository, rootDir } = await createRepository();
		await seedCompactedTurn(repository);

		const transition = await repository.continueConversation({
			sourceSessionId: "source-session",
			expectedVersion: 6,
			turnId: "turn-1",
			snapshotId: "snapshot-1",
			reason: "memory-rollover",
			timestamp: 20,
		});

		expect(transition.sessionId).not.toBe("source-session");
		expect(transition.sourceSessionPath).toBe(repository.resolveConversationPath("source-session"));
		expect(transition.sessionPath).toBe(repository.resolveConversationPath(transition.sessionId));
		expect(transition.seedDocument).toMatchObject({
			journalVersion: 0,
			revision: 3,
			activeLeafId: "seed-3",
			entries: [
				{ type: "compaction", id: "seed-1", parentId: null, firstKeptEntryId: "seed-2" },
				{ type: "message", id: "seed-2", parentId: "seed-1" },
				{ type: "message", id: "seed-3", parentId: "seed-2" },
			],
		});
		expect(transition.seedConversation.messages.map(messageText)).toEqual(["summary", "kept", "after"]);

		const source = await repository.load("source-session");
		expect(source.version).toBe(7);
		expect(source.events.at(-1)).toEqual(transition.transferredEvent);
		expect(new FailInterruptedTurnRecoveryPolicy().plan(source)).toEqual({ status: "ready" });

		const target = await repository.load(transition.sessionId);
		expect(target.version).toBe(1);
		expect(target.events).toEqual([transition.continuedEvent]);
		expect(target.messages.map(messageText)).toEqual(["summary", "kept", "after"]);
		expect(new FailInterruptedTurnRecoveryPolicy().plan(target)).toEqual({
			status: "interrupt",
			turnId: "turn-1",
		});
		expect((await repository.readDocument(transition.sessionId)).identity).toMatchObject({
			parentSessionPath: transition.sourceSessionPath,
			parentEntryId: "event-5",
		});

		await repository.append(transition.sessionId, 1, [
			{
				type: "turn.completed",
				sessionId: transition.sessionId,
				turnId: "turn-1",
				stopReason: "stop",
				timestamp: 21,
			},
		]);
		expect(new FailInterruptedTurnRecoveryPolicy().plan(await repository.load(transition.sessionId))).toEqual({
			status: "ready",
		});

		await repository.close();
		const reopened = new FileConversationRepository({ rootDir });
		expect((await reopened.load(transition.sessionId)).messages.map(messageText)).toEqual([
			"summary",
			"kept",
			"after",
		]);
		await reopened.close();
	});

	it("does not create a target file when the source version conflicts", async () => {
		const { repository, rootDir } = await createRepository();
		await seedCompactedTurn(repository);
		const before = await conversationFiles(rootDir);

		await expect(
			repository.continueConversation({
				sourceSessionId: "source-session",
				expectedVersion: 5,
				turnId: "turn-1",
				snapshotId: "snapshot-1",
				reason: "memory-rollover",
				timestamp: 20,
			}),
		).rejects.toMatchObject({ code: CONVERSATION_STORAGE_ERROR_CODES.VERSION_CONFLICT });
		expect(await conversationFiles(rootDir)).toEqual(before);
		await repository.close();
	});
});

async function createRepository(): Promise<{
	readonly repository: FileConversationRepository;
	readonly rootDir: string;
}> {
	const rootDir = await mkdtemp(join(tmpdir(), "vetta-conversation-continuation-"));
	temporaryRoots.push(rootDir);
	return { repository: new FileConversationRepository({ rootDir }), rootDir };
}

async function seedCompactedTurn(repository: FileConversationRepository): Promise<void> {
	await repository.create({ sessionId: "source-session", createdAt: 1 });
	await repository.append("source-session", 0, [
		{
			type: "turn.started",
			sessionId: "source-session",
			turnId: "turn-1",
			snapshotId: "snapshot-1",
			timestamp: 2,
		},
		messageEvent("source-session", userMessage("discarded", 3)),
		messageEvent("source-session", assistantMessage("discarded response", 4)),
		messageEvent("source-session", userMessage("kept", 5)),
		{
			type: "context.compacted",
			sessionId: "source-session",
			turnId: "turn-1",
			record: {
				summary: "summary",
				summaryMessage: userMessage("summary", 6),
				firstKeptEntryId: "event-4",
				tokensBefore: 1_000,
				reason: "threshold",
			},
			timestamp: 6,
		},
		messageEvent("source-session", assistantMessage("after", 7)),
	]);
}

function messageEvent(sessionId: string, message: Message) {
	return {
		type: "message.appended" as const,
		sessionId,
		turnId: "turn-1",
		message,
		timestamp: message.timestamp,
	};
}

function userMessage(content: string, timestamp: number): UserMessage {
	return { role: "user", content, timestamp };
}

function assistantMessage(text: string, timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "test",
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
	};
}

function messageText(message: Message): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((content) => content.type === "text")
		.map((content) => content.text)
		.join("");
}

async function conversationFiles(rootDir: string): Promise<string[]> {
	return (await readdir(rootDir)).filter((file) => file.endsWith(".conversation.jsonl")).sort();
}
