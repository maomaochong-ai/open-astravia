import { describe, expect, it } from "vitest";
import { SessionContextStateProjection } from "./session-context-state-projection.js";

const dynamic = { contextPercent: 6, contextTokens: 60, contextWindow: 100, activeToolNames: [] };

describe("SessionContextStateProjection", () => {
	it("publishes queued, running and completed state from session events", () => {
		const projection = new SessionContextStateProjection();
		const initial = projection.update("s1", dynamic, { status: "eligible" });
		expect(initial?.compaction.status).toBe("idle");

		const queued = projection.update(
			"s1",
			dynamic,
			{ status: "eligible" },
			{
				schemaVersion: 1,
				channel: "runtime",
				sessionId: "s1",
				eventId: "e1",
				timestamp: 1,
				source: "runtime-core",
				type: "queue.changed",
				paused: false,
				entries: [{ id: "q1", behavior: "followUp", kind: "context_compaction", displayText: "compact" }],
				snapshot: {},
			},
		);
		expect(queued?.compaction.status).toBe("queued");
		expect(queued?.compaction.queueId).toBe("q1");

		const running = projection.update(
			"s1",
			dynamic,
			{ status: "eligible" },
			{
				schemaVersion: 1,
				channel: "runtime",
				sessionId: "s1",
				eventId: "e2",
				timestamp: 2,
				source: "runtime-core",
				type: "compaction.start",
				reason: "manual",
			},
		);
		expect(running?.compaction.status).toBe("running");

		const completed = projection.update(
			"s1",
			{ ...dynamic, contextPercent: 2 },
			{ status: "eligible" },
			{
				schemaVersion: 1,
				channel: "runtime",
				sessionId: "s1",
				eventId: "e3",
				timestamp: 3,
				source: "runtime-core",
				type: "compaction.end",
				success: true,
				reason: "manual",
			},
		);
		expect(completed?.compaction.status).toBe("completed");
		expect(completed?.usage.percent).toBe(2);
	});

	it("does not carry state across sessions", () => {
		const projection = new SessionContextStateProjection();
		projection.update("old", dynamic, { status: "eligible" });
		const next = projection.update("new", dynamic, { status: "unknown" });
		expect(next?.sessionId).toBe("new");
		expect(next?.revision).toBe(1);
		expect(next?.compaction.status).toBe("idle");
	});
});
