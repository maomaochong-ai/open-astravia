import { CODING_AGENT_TODO_OBSERVATION, type TodoItem } from "@vetta/coding-agent/session-extensions";
import type { SessionEvent } from "@vetta/runtime-core";
import { sessionExtensionObservation } from "@vetta/runtime-core/session-extensions";
import { describe, expect, it } from "vitest";
import { mapSupplementalSessionEvent } from "../src/print-session-adapter.js";

describe("CLI print session extension event adapter", () => {
	it("preserves the public Todo print event while Runtime Core uses the generic envelope", () => {
		const event = extensionEvent([{ id: 1, content: "Print Todo", status: "pending" }]);

		expect(mapSupplementalSessionEvent(event)).toEqual({
			type: "todo_update",
			items: [{ id: 1, content: "Print Todo", status: "pending" }],
		});
	});

	it("ignores malformed Todo payloads", () => {
		const event = extensionEvent([]);
		if (event.type !== "session.extension") throw new Error("Expected extension event");

		expect(
			mapSupplementalSessionEvent({
				...event,
				payload: [{ id: "wrong", content: "Invalid", status: "pending" }],
			}),
		).toBeUndefined();
	});
});

function extensionEvent(payload: readonly TodoItem[]): SessionEvent {
	return {
		...sessionExtensionObservation(CODING_AGENT_TODO_OBSERVATION, payload),
		schemaVersion: 1,
		sessionId: "session",
		eventId: "event",
		timestamp: 1,
		source: "tool",
	};
}
