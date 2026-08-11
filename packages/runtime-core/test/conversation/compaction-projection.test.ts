import type { AssistantMessage, Message, UserMessage } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import {
	applyStoredEventToConversationDocument,
	createEmptyConversationDocument,
	selectConversationDocumentMessages,
	selectConversationDocumentModelMessages,
} from "../../src/conversation/index.js";
import type { StoredSessionEvent } from "../../src/kernel/index.js";

describe("conversation compaction projection", () => {
	it("projects native compaction as summary plus kept tail while preserving full chat history", () => {
		const events: StoredSessionEvent[] = [
			started(1),
			message(2, user("old request", 2)),
			message(3, assistant("old response", 3)),
			message(4, user("kept request", 4)),
			{
				type: "context.compacted",
				sessionId: "session-1",
				turnId: "turn-1",
				record: {
					summary: "earlier work",
					summaryMessage: user("<summary>earlier work</summary>", 5),
					firstKeptEntryId: "event-4",
					tokensBefore: 120,
					reason: "threshold",
				},
				timestamp: 5,
			},
			message(6, assistant("after compaction", 6)),
		];
		let document = createEmptyConversationDocument({ sessionId: "session-1", createdAt: 0 });
		for (let index = 0; index < events.length; index += 1) {
			document = applyStoredEventToConversationDocument(document, events[index] as StoredSessionEvent, index + 1);
		}

		expect(selectConversationDocumentMessages(document).map(text)).toEqual([
			"old request",
			"old response",
			"kept request",
			"after compaction",
		]);
		expect(selectConversationDocumentModelMessages(document).map(text)).toEqual([
			"<summary>earlier work</summary>",
			"kept request",
			"after compaction",
		]);
		expect(document.entries.at(-2)).toMatchObject({
			type: "compaction",
			id: "event-5",
			parentId: "event-4",
			firstKeptEntryId: "event-4",
			tokensBefore: 120,
			reason: "threshold",
		});
	});

	it("keeps early count-only records readable without changing the document branch", () => {
		const document = applyStoredEventToConversationDocument(
			createEmptyConversationDocument({ sessionId: "session-1", createdAt: 0 }),
			{
				type: "context.compacted",
				sessionId: "session-1",
				turnId: "turn-1",
				record: { id: "legacy", sourceMessageCount: 4, resultMessageCount: 2 },
				timestamp: 1,
			},
			1,
		);

		expect(document.journalVersion).toBe(1);
		expect(document.revision).toBe(0);
		expect(document.entries).toEqual([]);
	});
});

function started(timestamp: number): StoredSessionEvent {
	return {
		type: "turn.started",
		sessionId: "session-1",
		turnId: "turn-1",
		snapshotId: "snapshot-1",
		timestamp,
	};
}

function message(timestamp: number, value: UserMessage | AssistantMessage): StoredSessionEvent {
	return {
		type: "message.appended",
		sessionId: "session-1",
		turnId: "turn-1",
		message: value,
		timestamp,
	};
}

function user(content: string, timestamp: number): UserMessage {
	return { role: "user", content, timestamp };
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

function text(messageValue: Message): string {
	if (typeof messageValue.content === "string") return messageValue.content;
	return messageValue.content
		.filter((item): item is { readonly type: "text"; readonly text: string } => item.type === "text")
		.map(({ text: value }) => value)
		.join("");
}
