import { describe, expect, it } from "vitest";
import { mapRuntimeSessionObservationEvent } from "./session-events.js";

describe("mapRuntimeSessionObservationEvent", () => {
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
});
