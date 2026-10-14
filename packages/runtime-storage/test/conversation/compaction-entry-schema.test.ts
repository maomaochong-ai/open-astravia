import { describe, expect, it } from "vitest";
import {
	CONVERSATION_SCHEMA_VERSION,
	isConversationContinuationSeedRecord,
} from "../../src/conversation/record-schema.js";

describe("conversation compaction entry schema", () => {
	it("keeps the turn that triggered an automatic compaction in a continuation seed", () => {
		expect(isConversationContinuationSeedRecord(seed(compactionEntry({ turnId: "turn-1" })))).toBe(true);
	});

	it("keeps a manual compaction a session fact without a turn", () => {
		const entry = compactionEntry({});
		expect(entry).not.toHaveProperty("turnId");
		expect(isConversationContinuationSeedRecord(seed(entry))).toBe(true);
	});

	it("rejects unknown compaction properties", () => {
		expect(
			isConversationContinuationSeedRecord(seed({ ...compactionEntry({ turnId: "turn-1" }), turn: "turn-1" })),
		).toBe(false);
	});
});

function seed(entry: Record<string, unknown>): Record<string, unknown> {
	return {
		recordType: "conversation.continuation.seed",
		schemaVersion: CONVERSATION_SCHEMA_VERSION,
		sourceSessionId: "session-source",
		sourceSessionPath: "/sessions/session-source.jsonl",
		sourceEntryId: "event-2",
		reason: "memory-rollover",
		entries: [entry],
		activeLeafId: "event-2",
	};
}

function compactionEntry(extra: Record<string, unknown>): Record<string, unknown> {
	return {
		type: "compaction",
		id: "event-2",
		parentId: null,
		timestamp: "2026-01-01T00:00:00.000Z",
		summary: "earlier work",
		firstKeptEntryId: "event-1",
		tokensBefore: 120,
		reason: "threshold",
		...extra,
	};
}
