import type { StoredSessionEvent } from "@vetta/runtime-core/kernel";
import { describe, expect, it, vi } from "vitest";
import { createEcosystemHookTurnObserver } from "../../src/composition/turn/ecosystem-hook-turn-observer.js";

describe("ecosystem Hook turn observer", () => {
	it("releases dynamic Hook contributions for every terminal turn outcome", async () => {
		const finishCurrentTurn = vi.fn();
		const observer = createEcosystemHookTurnObserver({ finishCurrentTurn });
		const signal = new AbortController().signal;
		const events: StoredSessionEvent[] = [
			{
				type: "turn.started",
				sessionId: "session-1",
				turnId: "turn-1",
				snapshotId: "snapshot-1",
				timestamp: 1,
			},
			{
				type: "turn.completed",
				sessionId: "session-1",
				turnId: "turn-1",
				stopReason: "stop",
				timestamp: 2,
			},
			{
				type: "turn.cancelled",
				sessionId: "session-1",
				turnId: "turn-2",
				timestamp: 3,
			},
			{
				type: "turn.failed",
				sessionId: "session-1",
				turnId: "turn-3",
				error: { code: "failed", message: "failed" },
				timestamp: 4,
			},
		];

		for (const event of events) await observer.observe(event, signal);
		expect(finishCurrentTurn).toHaveBeenCalledTimes(3);
	});
});
