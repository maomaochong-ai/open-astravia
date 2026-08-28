import {
	CODING_AGENT_SUBAGENTS_OBSERVATION,
	CODING_AGENT_TODO_OBSERVATION,
	type CodingAgentSubagentSnapshot,
	type TodoItem,
} from "@vetta/coding-agent/session-extensions";
import type { SessionEvent } from "@vetta/runtime-core";
import { sessionExtensionObservation } from "@vetta/runtime-core/session-extensions";
import { describe, expect, it } from "vitest";
import { mapSupplementalSessionEvent } from "../src/print-session-adapter.js";

describe("CLI print session extension event adapter", () => {
	it("preserves the public Todo print event while Runtime Core uses the generic envelope", () => {
		const event = extensionEvent(CODING_AGENT_TODO_OBSERVATION, [
			{ id: 1, content: "Print Todo", status: "pending" },
		] satisfies readonly TodoItem[]);

		expect(mapSupplementalSessionEvent(event)).toEqual({
			type: "todo_update",
			items: [{ id: 1, content: "Print Todo", status: "pending" }],
		});
	});

	it("ignores malformed Todo payloads", () => {
		const event = extensionEvent(CODING_AGENT_TODO_OBSERVATION, []);
		if (event.type !== "session.extension") throw new Error("Expected extension event");

		expect(
			mapSupplementalSessionEvent({
				...event,
				payload: [{ id: "wrong", content: "Invalid", status: "pending" }],
			}),
		).toBeUndefined();
	});

	it("maps the Coding Agent Subagent extension observation to the legacy print event", () => {
		const agents: readonly CodingAgentSubagentSnapshot[] = [
			{
				id: "child-1",
				taskName: "inspect_repo",
				path: "/root/inspect_repo",
				agentType: "workflow",
				status: "running",
				task: "Inspect repository",
				parentSessionId: "parent",
				startedAt: 1,
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costTotal: 0 },
				generation: 0,
				todoProgress: { done: 1, total: 2 },
			},
		];

		expect(mapSupplementalSessionEvent(extensionEvent(CODING_AGENT_SUBAGENTS_OBSERVATION, agents))).toEqual({
			type: "subagents_update",
			agents,
		});
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
