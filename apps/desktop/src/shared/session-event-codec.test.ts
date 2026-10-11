import type { AssistantMessage } from "@astravia/ai";
import { describe, expect, it } from "vitest";
import { decodeSessionEvent } from "./session-event-codec";

describe("decodeSessionEvent", () => {
	it("preserves request boundaries and rejects missing or invalid model-call identity", () => {
		const event = {
			schemaVersion: 1,
			channel: "runtime",
			sessionId: "session-1",
			eventId: "request-1",
			timestamp: 10,
			source: "agent",
			type: "model.request.started",
			turnId: "turn-1",
			modelCallIndex: 0,
		};
		expect(decodeSessionEvent(event)).toBe(event);
		for (const invalid of [{ turnId: "" }, { turnId: undefined }, { modelCallIndex: -1 }, { modelCallIndex: 0.5 }]) {
			expect(() => decodeSessionEvent({ ...event, ...invalid })).toThrow();
		}
	});

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

	it("accepts identity-complete conversation facts and rejects missing identities", () => {
		const started = {
			schemaVersion: 1,
			channel: "runtime",
			sessionId: "session-1",
			eventId: "turn-started-1",
			timestamp: 10,
			source: "runtime-core",
			type: "conversation.turn.started",
			turnId: "turn-1",
		};
		const message = {
			...started,
			eventId: "message-1",
			type: "conversation.message.appended",
			messageId: "user-1",
			message: { role: "user", content: "hello" },
		};

		expect(decodeSessionEvent(started)).toBe(started);
		expect(decodeSessionEvent(message)).toBe(message);
		expect(() => decodeSessionEvent({ ...started, turnId: "" })).toThrow("conversation turnId is missing");
		expect(() => decodeSessionEvent({ ...message, messageId: "" })).toThrow("conversation messageId is missing");
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

	it("lets compaction summary deltas through so the live card can stream", () => {
		// 回归：白名单曾缺 compaction.delta，decodeSessionEvent 抛 "unknown event type"，
		// 整条流式压缩卡链路（运行时发布 → IPC → compactionLiveSummaryAtom → 卡片）在此断开。
		const delta = {
			schemaVersion: 1,
			channel: "runtime",
			sessionId: "session-1",
			eventId: "delta-1",
			timestamp: 10,
			source: "agent",
			type: "compaction.delta",
			text: "## Primary Goal\n做某事",
		};
		expect(decodeSessionEvent(delta)).toBe(delta);
		for (const invalid of [{ text: undefined }, { text: 42 }, { text: "" }]) {
			expect(() => decodeSessionEvent({ ...delta, ...invalid })).toThrow("compaction delta text is invalid");
		}
	});

	it("keeps the remaining compaction lifecycle events decodable", () => {
		const start = {
			schemaVersion: 1,
			channel: "runtime",
			sessionId: "session-1",
			eventId: "start-1",
			timestamp: 10,
			source: "agent",
			type: "compaction.start",
			reason: "threshold",
			tokensBefore: 419967,
		};
		const end = {
			schemaVersion: 1,
			channel: "runtime",
			sessionId: "session-1",
			eventId: "end-1",
			timestamp: 20,
			source: "agent",
			type: "compaction.end",
			success: true,
			reason: "threshold",
		};
		expect(decodeSessionEvent(start)).toBe(start);
		expect(decodeSessionEvent(end)).toBe(end);
	});
});
