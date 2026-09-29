import { describe, expect, it } from "vitest";
import type { KernelEvent } from "../kernel/contracts.js";
import { mapKernelEventToSessionEvents } from "./kernel-session-events.js";

describe("mapKernelEventToSessionEvents identity contract", () => {
	it("publishes committed user messages with stable Turn and message identities", () => {
		const events = mapKernelEventToSessionEvents({
			type: "message.appended",
			sessionId: "session-1",
			turnId: "turn-2",
			messageId: "user-3",
			message: { role: "user", content: "queued prompt", timestamp: 10 },
			timestamp: 11,
		});

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "conversation.message.appended",
			sessionId: "session-1",
			turnId: "turn-2",
			messageId: "user-3",
		});
	});

	it.each([
		[
			"turn.started",
			{ type: "turn.started", sessionId: "session-1", turnId: "turn-2", snapshotId: "snap", timestamp: 1 },
			"conversation.turn.started",
		],
		[
			"turn.completed",
			{ type: "turn.completed", sessionId: "session-1", turnId: "turn-2", stopReason: "stop", timestamp: 2 },
			"conversation.turn.completed",
		],
		[
			"turn.cancelled",
			{ type: "turn.cancelled", sessionId: "session-1", turnId: "turn-2", reason: "send-now", timestamp: 3 },
			"conversation.turn.cancelled",
		],
	] as const)("maps %s from the durable fact", (_label, event, expectedType) => {
		expect(mapKernelEventToSessionEvents(event as KernelEvent)[0]).toMatchObject({
			type: expectedType,
			turnId: "turn-2",
		});
	});
});
