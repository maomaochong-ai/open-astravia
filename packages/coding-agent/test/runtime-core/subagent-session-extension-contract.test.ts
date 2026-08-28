import type { SessionEvent } from "@vetta/runtime-core";
import { defineSessionExtensionObservation, sessionExtensionObservation } from "@vetta/runtime-core/session-extensions";
import { describe, expect, it } from "vitest";
import {
	CODING_AGENT_SUBAGENTS_OBSERVATION,
	readCodingAgentSubagentsObservation,
} from "../../src/composition/subagent/subagent-session-extension-contract.js";

describe("Coding Agent Subagent session extension contract", () => {
	it("validates and copies product snapshots at the host boundary", () => {
		const snapshots = [snapshot()];
		const parsed = readCodingAgentSubagentsObservation(extensionEvent(CODING_AGENT_SUBAGENTS_OBSERVATION, snapshots));

		expect(parsed).toEqual(snapshots);
		expect(parsed).not.toBe(snapshots);
		expect(parsed?.[0]).not.toBe(snapshots[0]);
		expect(parsed?.[0]?.usage).not.toBe(snapshots[0]?.usage);
		expect(parsed?.[0]?.todoProgress).not.toBe(snapshots[0]?.todoProgress);
	});

	it("rejects unrelated observations and malformed product payloads", () => {
		const unrelated = defineSessionExtensionObservation<readonly unknown[]>("other.extension", "changed");
		expect(readCodingAgentSubagentsObservation(extensionEvent(unrelated, []))).toBeUndefined();
		const envelope = extensionEvent(CODING_AGENT_SUBAGENTS_OBSERVATION, []);
		if (envelope.type !== "session.extension") throw new Error("Expected extension event");
		const malformed: SessionEvent = { ...envelope, payload: [{ ...snapshot(), status: "unknown" }] };
		expect(readCodingAgentSubagentsObservation(malformed)).toBeUndefined();
	});
});

function snapshot() {
	return {
		id: "child-1",
		taskName: "inspect_repo",
		path: "/root/inspect_repo",
		agentType: "workflow",
		status: "running" as const,
		task: "Inspect repository",
		parentSessionId: "parent",
		startedAt: 1,
		usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, costTotal: 5 },
		generation: 0,
		todoProgress: { done: 1, total: 2 },
	};
}

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
