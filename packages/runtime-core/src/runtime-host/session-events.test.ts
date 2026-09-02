import type { AssistantMessage, AssistantMessageEvent } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { mapRuntimeSessionObservationEvent } from "./session-events.js";

describe("mapRuntimeSessionObservationEvent", () => {
	it("preserves the original assistant protocol event without field mapping", () => {
		const partial = {
			role: "assistant",
			content: [{ type: "text", text: "hel" }],
		} as unknown as AssistantMessage;
		const assistantEvent: AssistantMessageEvent = {
			type: "text_delta",
			contentIndex: 0,
			delta: "l",
			partial,
		};

		const event = mapRuntimeSessionObservationEvent(
			"session-1",
			{
				type: "assistant.event",
				modelCallIndex: 2,
				event: assistantEvent,
				source: "agent",
			},
			123,
			{ turnId: "turn-7" },
		);

		expect(event).toMatchObject({
			type: "text_delta",
			channel: "assistant",
			turnId: "turn-7",
			modelCallIndex: 2,
			timestamp: 123,
		});
		if (event.channel !== "assistant") throw new Error("Expected assistant event");
		expect(event).toMatchObject(assistantEvent);
	});

	it("maps retry lifecycle without depending on a Coding Agent implementation", () => {
		const start = mapRuntimeSessionObservationEvent("session-1", {
			type: "retry.start",
			attempt: 2,
			maxAttempts: 3,
			delayMs: 4000,
			errorMessage: "rate limited",
			source: "agent",
		});
		const end = mapRuntimeSessionObservationEvent("session-1", {
			type: "retry.end",
			success: false,
			attempt: 2,
			finalError: "rate limited",
			source: "agent",
		});

		expect(start).toMatchObject({
			type: "retry.start",
			sessionId: "session-1",
			attempt: 2,
			maxAttempts: 3,
			delayMs: 4000,
			errorMessage: "rate limited",
		});
		expect(end).toMatchObject({
			type: "retry.end",
			sessionId: "session-1",
			success: false,
			attempt: 2,
			finalError: "rate limited",
		});
	});

	it("copies active tool names into the host event", () => {
		const activeToolNames = ["read", "progress"];
		const event = mapRuntimeSessionObservationEvent("session-1", {
			type: "active_tools_update",
			activeToolNames,
			source: "runtime-core",
		});

		expect(event).toMatchObject({ type: "active_tools_update", activeToolNames });
		if (event.type !== "active_tools_update") throw new Error("Expected active tools event");
		expect(event.activeToolNames).not.toBe(activeToolNames);
	});

	it("preserves structured failures on retry and compaction observations", () => {
		const failure = {
			code: "AI_RATE_LIMITED",
			message: "rate limited",
			retryable: true,
			origin: "provider" as const,
		};
		const retry = mapRuntimeSessionObservationEvent("session-1", {
			type: "retry.start",
			attempt: 1,
			maxAttempts: 2,
			delayMs: 100,
			errorMessage: failure.message,
			failure,
			source: "agent",
		});
		const compaction = mapRuntimeSessionObservationEvent("session-1", {
			type: "compaction.end",
			success: false,
			reason: "threshold",
			tokensBefore: 91_000,
			errorMessage: failure.message,
			failure,
			source: "agent",
		});
		expect(retry).toMatchObject({ failure });
		expect(compaction).toMatchObject({ reason: "threshold", tokensBefore: 91_000, failure });
	});

	it("preserves automatic compaction threshold diagnostics", () => {
		const event = mapRuntimeSessionObservationEvent("session-1", {
			type: "compaction.start",
			reason: "threshold",
			contextTokens: 91_000,
			contextWindow: 100_000,
			thresholdTokens: 90_000,
			source: "agent",
		});

		expect(event).toMatchObject({
			type: "compaction.start",
			contextTokens: 91_000,
			contextWindow: 100_000,
			thresholdTokens: 90_000,
		});
	});
});
