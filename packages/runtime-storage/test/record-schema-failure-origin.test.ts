import { describe, expect, it } from "vitest";
import {
	CONVERSATION_SCHEMA_VERSION,
	isStoredSessionEvent,
	readConversationEventRecord,
} from "../src/conversation/index.js";

const baseFailureEvent = {
	type: "turn.failed" as const,
	sessionId: "session-1",
	turnId: "turn-1",
	error: { code: "EXTENSION_FAILED", message: "failed", retryable: false },
	timestamp: 1,
};

describe("conversation failure origin schema", () => {
	it("accepts the generic extension origin for new writes", () => {
		expect(
			isStoredSessionEvent({
				...baseFailureEvent,
				error: { ...baseFailureEvent.error, origin: "extension" },
			}),
		).toBe(true);
	});

	it("normalizes a historical product-owned origin while reading", () => {
		const record = readConversationEventRecord({
			recordType: "conversation.event",
			schemaVersion: CONVERSATION_SCHEMA_VERSION,
			sequence: 1,
			event: {
				...baseFailureEvent,
				error: { ...baseFailureEvent.error, origin: "mcp" },
			},
			documentEntry: null,
		});

		expect(record?.event).toMatchObject({ type: "turn.failed", error: { origin: "extension" } });
		expect(isStoredSessionEvent(record?.event)).toBe(true);
	});
});
