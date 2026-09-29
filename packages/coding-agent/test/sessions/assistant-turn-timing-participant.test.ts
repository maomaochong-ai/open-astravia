import type { StoredSessionEvent } from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import {
	ASSISTANT_TURN_TIMING_TYPE,
	AssistantTurnTimingParticipant,
} from "../../src/sessions/timing/assistant-turn-timing-participant.js";

describe("AssistantTurnTimingParticipant", () => {
	it.each([
		["turn.completed", { stopReason: "stop" }],
		["turn.cancelled", { reason: "cancelled by user" }],
		["turn.failed", { error: { message: "provider failed", kind: "provider" } }],
	] as const)("persists elapsed time when a turn reaches %s", async (type, details) => {
		const appendCustomEntry = vi.fn(async () => undefined);
		const participant = new AssistantTurnTimingParticipant();
		await participant.initialize({} as never, { appendCustomEntry });
		await participant.onSessionEvent?.({
			type: "turn.started",
			sessionId: "session",
			turnId: "turn",
			snapshotId: "snapshot",
			timestamp: 1_000,
		});
		await participant.onSessionEvent?.({
			type,
			sessionId: "session",
			turnId: "turn",
			timestamp: 4_250,
			...details,
		} as StoredSessionEvent);

		expect(appendCustomEntry).toHaveBeenCalledWith({
			entryId: "assistant-turn-timing:turn",
			customType: ASSISTANT_TURN_TIMING_TYPE,
			data: { startedAt: 1_000, endedAt: 4_250, durationMs: 3_250 },
			timestamp: new Date(4_250).toISOString(),
		});
	});

	it("does not invent timing when the start event is unavailable", async () => {
		const appendCustomEntry = vi.fn(async () => undefined);
		const participant = new AssistantTurnTimingParticipant();
		await participant.initialize({} as never, { appendCustomEntry });
		await participant.onSessionEvent?.({
			type: "turn.completed",
			sessionId: "session",
			turnId: "turn",
			stopReason: "stop",
			timestamp: 4_250,
		});

		expect(appendCustomEntry).not.toHaveBeenCalled();
	});

	it("keeps the original start when a running turn continues in a new conversation", async () => {
		const appendCustomEntry = vi.fn(async () => undefined);
		const participant = new AssistantTurnTimingParticipant();
		await participant.initialize({} as never, { appendCustomEntry });
		await participant.onSessionEvent?.({
			type: "turn.started",
			sessionId: "source",
			turnId: "turn",
			snapshotId: "source-snapshot",
			timestamp: 1_000,
		});
		await participant.onSessionEvent?.({
			type: "turn.continued",
			sessionId: "target",
			sourceSessionId: "source",
			turnId: "turn",
			snapshotId: "target-snapshot",
			reason: "context rollover",
			timestamp: 3_000,
		});
		await participant.onSessionEvent?.({
			type: "turn.completed",
			sessionId: "target",
			turnId: "turn",
			stopReason: "stop",
			timestamp: 5_000,
		});

		expect(appendCustomEntry).toHaveBeenCalledWith(
			expect.objectContaining({ data: { startedAt: 1_000, endedAt: 5_000, durationMs: 4_000 } }),
		);
	});
});
