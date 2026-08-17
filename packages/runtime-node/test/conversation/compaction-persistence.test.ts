import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, Message } from "@vetta/ai";
import { afterEach, describe, expect, it } from "vitest";
import { FileConversationRepository } from "../../src/conversation/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("native conversation compaction persistence", () => {
	it("restores summary plus kept tail after closing and reopening the repository", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "vetta-compaction-"));
		temporaryRoots.push(rootDir);
		const repository = new FileConversationRepository({ rootDir });
		await repository.create({ sessionId: "session-1", createdAt: 1 });
		await repository.append("session-1", 0, [
			{
				type: "turn.started",
				sessionId: "session-1",
				turnId: "turn-1",
				snapshotId: "snapshot-1",
				timestamp: 1,
			},
			appended("turn-1", { role: "user", content: "old", timestamp: 2 }, 2),
			appended("turn-1", assistant("old answer", 3), 3),
			appended("turn-1", { role: "user", content: "kept", timestamp: 4 }, 4),
			{
				type: "context.compacted",
				sessionId: "session-1",
				turnId: "turn-1",
				record: {
					summary: "summary",
					summaryMessage: { role: "user", content: "<summary>summary</summary>", timestamp: 5 },
					firstKeptEntryId: "event-4",
					tokensBefore: 100,
					details: { source: "test" },
					reason: "threshold",
				},
				timestamp: 5,
			},
			appended("turn-1", assistant("new answer", 6), 6),
			{
				type: "turn.completed",
				sessionId: "session-1",
				turnId: "turn-1",
				stopReason: "stop",
				timestamp: 7,
			},
		]);
		await repository.close();

		const reopened = new FileConversationRepository({ rootDir });
		const conversation = await reopened.load("session-1");
		const document = await reopened.readDocument("session-1");

		expect(conversation.messages.map(text)).toEqual(["<summary>summary</summary>", "kept", "new answer"]);
		expect(document.entries.find(({ type }) => type === "compaction")).toMatchObject({
			id: "event-5",
			type: "compaction",
			firstKeptEntryId: "event-4",
			details: { source: "test" },
		});
		await reopened.close();
	});

	it("persists manual compaction between turns without inventing a turn id", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "vetta-manual-compaction-"));
		temporaryRoots.push(rootDir);
		const repository = new FileConversationRepository({ rootDir });
		await repository.create({ sessionId: "session-1", createdAt: 1 });
		await repository.append("session-1", 0, [
			{
				type: "turn.started",
				sessionId: "session-1",
				turnId: "turn-1",
				snapshotId: "snapshot-1",
				timestamp: 1,
			},
			appended("turn-1", { role: "user", content: "old", timestamp: 2 }, 2),
			appended("turn-1", assistant("old answer", 3), 3),
			appended("turn-1", { role: "user", content: "kept", timestamp: 4 }, 4),
			{
				type: "turn.completed",
				sessionId: "session-1",
				turnId: "turn-1",
				stopReason: "stop",
				timestamp: 5,
			},
		]);
		await repository.append("session-1", 5, [
			{
				type: "context.compacted",
				sessionId: "session-1",
				record: {
					summary: "manual summary",
					summaryMessage: {
						role: "user",
						content: "<summary>manual summary</summary>",
						timestamp: 6,
					},
					firstKeptEntryId: "event-4",
					tokensBefore: 100,
					details: { source: "manual-test" },
					reason: "manual",
				},
				timestamp: 6,
			},
		]);
		await repository.close();

		const reopened = new FileConversationRepository({ rootDir });
		const conversation = await reopened.load("session-1");
		const document = await reopened.readDocument("session-1");

		expect(conversation.messages.map(text)).toEqual(["<summary>manual summary</summary>", "kept"]);
		expect(conversation.events.at(-1)).toMatchObject({
			type: "context.compacted",
			record: { reason: "manual" },
		});
		expect(conversation.events.at(-1)).not.toHaveProperty("turnId");
		expect(document.entries.find(({ type }) => type === "compaction")).toMatchObject({
			id: "event-6",
			type: "compaction",
			firstKeptEntryId: "event-4",
			reason: "manual",
			details: { source: "manual-test" },
		});
		await reopened.close();
	});
});

function appended(turnId: string, message: Message, timestamp: number) {
	return {
		type: "message.appended" as const,
		sessionId: "session-1",
		turnId,
		message,
		timestamp,
	};
}

function assistant(content: string, timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: content }],
		api: "openai-responses",
		provider: "openai",
		model: "test",
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

function text(message: Message): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((item): item is { readonly type: "text"; readonly text: string } => item.type === "text")
		.map(({ text: value }) => value)
		.join("");
}
