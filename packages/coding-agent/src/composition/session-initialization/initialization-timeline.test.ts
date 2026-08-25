import { createRuntimeObservationPublisher, type RuntimeObservationRecord } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION } from "../contracts/session-initialization-observability.js";
import { createCodingAgentSessionInitializationTimeline } from "./initialization-timeline.js";

describe("coding agent session initialization timeline", () => {
	it("reports phase and total durations without observing resource contents", async () => {
		let currentTime = 0;
		const observations: RuntimeObservationRecord[] = [];
		const timeline = createCodingAgentSessionInitializationTimeline({
			sessionId: "session-1",
			operation: "create",
			now: () => currentTime,
			observationPublisher: createRuntimeObservationPublisher({
				port: {
					record: (observation) => {
						observations.push(observation);
					},
				},
			}),
		});

		const value = await timeline.measure("ownership", async () => {
			currentTime = 12.34;
			return "owned";
		});
		currentTime = 20;
		timeline.finish("completed");

		expect(value).toBe("owned");
		expect(observations.map(({ payload }) => payload)).toEqual([
			expect.objectContaining({
				operation: "create",
				status: "stage-completed",
				stage: "ownership",
				durationMs: 12.34,
			}),
			expect.objectContaining({ status: "completed", totalDurationMs: 20 }),
		]);
		expect(observations.map(({ token }) => token)).toEqual([
			CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION,
			CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION,
		]);
		expect(observations.map(({ context }) => context)).toEqual([
			{ sessionId: "session-1" },
			{ sessionId: "session-1" },
		]);
		expect(Object.keys(observations[0]?.payload ?? {}).sort()).toEqual(
			["durationMs", "operation", "stage", "status", "totalDurationMs"].sort(),
		);
	});

	it("records the failed phase and never lets observation delivery failures alter initialization", async () => {
		let currentTime = 0;
		const record = vi.fn(() => Promise.reject(new Error("adapter failed")));
		const timeline = createCodingAgentSessionInitializationTimeline({
			sessionId: "session-2",
			operation: "resume",
			now: () => currentTime,
			observationPublisher: createRuntimeObservationPublisher({ port: { record } }),
		});

		await expect(
			timeline.measure("plugin-skills", async () => {
				currentTime = 7;
				throw new Error("skill loading failed");
			}),
		).rejects.toThrow("skill loading failed");
		currentTime = 9;
		expect(() => timeline.finish("failed")).not.toThrow();
		timeline.finish("failed");
		expect(record).toHaveBeenLastCalledWith(
			expect.objectContaining({
				context: { sessionId: "session-2" },
				payload: expect.objectContaining({ status: "failed", failedStage: "plugin-skills", totalDurationMs: 9 }),
				token: CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION,
			}),
		);
		expect(record).toHaveBeenCalledTimes(2);
	});
});
