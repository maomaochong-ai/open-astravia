import { describe, expect, it } from "vitest";
import {
	applyStoredEventToConversationDocument,
	conversationDocumentEntryPersistence,
	createEmptyConversationDocument,
} from "../../src/conversation/index.js";
import type { StoredSessionEvent } from "../../src/kernel/contracts.js";

const SESSION_ID = "session-1";
const base = { sessionId: SESSION_ID, turnId: "turn-1", timestamp: 1 } as const;

const contextRecord = { type: "note", content: [{ type: "text" as const, text: "note" }], modelVisible: true };

const EVENTS: readonly StoredSessionEvent[] = [
	{ ...base, type: "turn.started", snapshotId: "snapshot-1" },
	{ ...base, type: "turn.continued", sourceSessionId: "session-0", snapshotId: "snapshot-1", reason: "fork" },
	{
		...base,
		type: "message.appended",
		message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
	},
	{ ...base, type: "context.appended", record: contextRecord },
	{ sessionId: SESSION_ID, timestamp: 1, type: "context.recorded", record: contextRecord },
	{
		...base,
		type: "context.compacted",
		record: { id: "compaction-1", sourceMessageCount: 2, resultMessageCount: 1, summary: "legacy" },
	},
	{ ...base, type: "turn.completed", stopReason: "stop" },
	{ ...base, type: "turn.cancelled" },
	{
		...base,
		type: "turn.failed",
		error: { code: "AI_TRANSPORT_FAILED", message: "terminated", retryable: false, origin: "provider" },
	},
	{ ...base, type: "turn.transferred", targetSessionId: "session-2", reason: "fork" },
];

describe("conversationDocumentEntryPersistence", () => {
	it.each(EVENTS.map((event) => [event.type, event] as const))(
		"agrees with the document projection for %s",
		(_type, event) => {
			const document = createEmptyConversationDocument({ sessionId: SESSION_ID, createdAt: 0 });
			const next = applyStoredEventToConversationDocument(document, event, 1);
			const createsEntry = next.entries.length === 1;
			expect(createsEntry).toBe(conversationDocumentEntryPersistence(event) !== "none");
		},
	);

	it("keeps turn.failed implicit so its reference is never persisted", () => {
		const failed = EVENTS.find((event) => event.type === "turn.failed");
		expect(failed && conversationDocumentEntryPersistence(failed)).toBe("implicit");
	});

	it("treats legacy compaction records as non-document events", () => {
		const legacy = EVENTS.find((event) => event.type === "context.compacted");
		expect(legacy && conversationDocumentEntryPersistence(legacy)).toBe("none");
	});
});
