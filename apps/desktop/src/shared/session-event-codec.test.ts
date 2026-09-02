import type { AssistantMessage } from "@vetta/ai";
import { describe, expect, it } from "vitest";
import { decodeSessionEvent } from "./session-event-codec";

describe("decodeSessionEvent", () => {
	it("keeps a valid raw assistant event structurally unchanged", () => {
		const payload = {
			schemaVersion: 1,
			sessionId: "session-1",
			eventId: "event-1",
			timestamp: 10,
			source: "agent",
			sequence: 3,
			channel: "assistant",
			turnId: "turn-1",
			modelCallIndex: 0,
			type: "text_delta",
			contentIndex: 0,
			delta: "hello",
			partial: { role: "assistant", content: [] } as unknown as AssistantMessage,
		};

		expect(decodeSessionEvent(payload)).toBe(payload);
	});

	it("rejects malformed raw assistant deltas", () => {
		expect(() =>
			decodeSessionEvent({
				schemaVersion: 1,
				sessionId: "session-1",
				eventId: "event-1",
				timestamp: 10,
				source: "agent",
				channel: "assistant",
				modelCallIndex: 0,
				type: "text_delta",
				contentIndex: 0,
				partial: {},
			}),
		).toThrow("assistant delta is missing");
	});

	it("rejects assistant event types without the assistant channel", () => {
		expect(() =>
			decodeSessionEvent({
				schemaVersion: 1,
				sessionId: "session-1",
				eventId: "event-1",
				timestamp: 10,
				source: "agent",
				type: "text_delta",
				contentIndex: 0,
				delta: "hello",
				partial: {},
			}),
		).toThrow("unknown event type");
	});
});
