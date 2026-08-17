import type { SessionEvent } from "@vetta/runtime-core";
import { defineSessionExtensionObservation, sessionExtensionObservation } from "@vetta/runtime-core/session-extensions";
import { describe, expect, it } from "vitest";
import {
	CODING_AGENT_TODO_OBSERVATION,
	readCodingAgentTodoObservation,
} from "../../../src/features/todo/todo-session-extension-contract.js";

describe("Coding Agent Todo session extension contract", () => {
	it("validates and copies Todo observations at the host boundary", () => {
		const items = [{ id: 1, content: "Inspect boundary", status: "in_progress" as const }];
		const event = extensionEvent(CODING_AGENT_TODO_OBSERVATION, items);

		const parsed = readCodingAgentTodoObservation(event);

		expect(parsed).toEqual(items);
		expect(parsed).not.toBe(items);
		expect(parsed?.[0]).not.toBe(items[0]);
	});

	it("rejects unrelated extension events and malformed Todo payloads", () => {
		const unrelated = defineSessionExtensionObservation<readonly unknown[]>("other.extension", "changed");
		expect(readCodingAgentTodoObservation(extensionEvent(unrelated, []))).toBeUndefined();
		const envelope = extensionEvent(CODING_AGENT_TODO_OBSERVATION, []);
		if (envelope.type !== "session.extension") throw new Error("Expected extension event");
		const malformed: SessionEvent = {
			...envelope,
			payload: [{ id: 1, content: "Invalid status", status: "blocked" }],
		};
		expect(readCodingAgentTodoObservation(malformed)).toBeUndefined();
	});
});

function extensionEvent<Payload>(
	token: Parameters<typeof sessionExtensionObservation<Payload>>[0],
	payload: Payload,
): SessionEvent {
	return {
		...sessionExtensionObservation(token, payload),
		schemaVersion: 1,
		sessionId: "session",
		eventId: "event",
		timestamp: 1,
		source: "tool",
	};
}
