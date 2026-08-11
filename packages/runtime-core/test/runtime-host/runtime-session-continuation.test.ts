import type { UserMessage } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { createSeededConversationDocument } from "../../src/conversation/index.js";
import type { ConversationContinuedEvent, StoredConversation } from "../../src/kernel/index.js";
import { mapKernelEventToSessionEvents, RuntimeSessionProjection } from "../../src/runtime-host/index.js";

describe("Runtime session continuation projection", () => {
	it("rebinds a projection before applying the persisted turn continuation", () => {
		const sourceConversation: StoredConversation = {
			sessionId: "source-session",
			createdAt: 1,
			version: 0,
			messages: [],
			events: [],
		};
		const sourceDocument = createSeededConversationDocument({ sessionId: "source-session", createdAt: 1 }, [], null);
		const projection = new RuntimeSessionProjection(sourceConversation, sourceDocument);
		const seedDocument = createSeededConversationDocument(
			{
				sessionId: "target-session",
				createdAt: 2,
				parentSessionPath: "sessions/source.conversation.jsonl",
				parentEntryId: "event-4",
			},
			[
				{
					type: "compaction",
					id: "seed-1",
					parentId: null,
					timestamp: new Date(2).toISOString(),
					summary: "summary",
					summaryMessage: userMessage("summary"),
					firstKeptEntryId: "seed-2",
					tokensBefore: 100,
					reason: "threshold",
				},
				{
					type: "message",
					id: "seed-2",
					parentId: "seed-1",
					timestamp: new Date(2).toISOString(),
					message: userMessage("kept"),
				},
			],
			"seed-2",
		);
		const seedConversation: StoredConversation = {
			sessionId: "target-session",
			createdAt: 2,
			version: 0,
			messages: [userMessage("summary"), userMessage("kept")],
			events: [],
		};
		const transition: ConversationContinuedEvent = {
			type: "conversation.continued",
			sourceSessionId: "source-session",
			sourceSessionPath: "sessions/source.conversation.jsonl",
			sessionId: "target-session",
			sessionPath: "sessions/target.conversation.jsonl",
			turnId: "turn-1",
			reason: "memory-rollover",
			conversation: seedConversation,
			document: seedDocument,
			timestamp: 2,
		};

		projection.replaceConversation(transition.conversation, transition.document);
		projection.apply({
			type: "turn.continued",
			sessionId: "target-session",
			sourceSessionId: "source-session",
			turnId: "turn-1",
			snapshotId: "snapshot-1",
			reason: "memory-rollover",
			timestamp: 2,
		});

		expect(projection.readDocument()).toMatchObject({
			identity: { sessionId: "target-session" },
			journalVersion: 1,
			revision: 2,
		});
		expect(projection.readMessages().map((message) => message.content)).toEqual(["kept"]);
		expect(mapKernelEventToSessionEvents(transition)).toMatchObject([
			{
				type: "session.path_changed",
				sessionId: "target-session",
				previousSessionId: "source-session",
				previousPath: "sessions/source.conversation.jsonl",
				path: "sessions/target.conversation.jsonl",
				reason: "memory-rollover",
			},
		]);
	});
});

function userMessage(content: string): UserMessage {
	return { role: "user", content, timestamp: 2 };
}
