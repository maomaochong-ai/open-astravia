import { describe, expect, it, vi } from "vitest";
import type { CodingAgentSessionInitializationObservation } from "../contracts/session-initialization-observability.js";
import { createCodingAgentSessionInitializationTimeline } from "./initialization-timeline.js";

describe("coding agent session initialization timeline", () => {
	it("reports phase and total durations without observing resource contents", async () => {
		let currentTime = 0;
		const observations: CodingAgentSessionInitializationObservation[] = [];
		const timeline = createCodingAgentSessionInitializationTimeline({
			sessionId: "session-1",
			operation: "create",
			now: () => currentTime,
			observer: (observation) => observations.push(observation),
		});

		const value = await timeline.measure("ownership", async () => {
			currentTime = 12.34;
			return "owned";
		});
		currentTime = 20;
		timeline.finish("completed");

		expect(value).toBe("owned");
		expect(observations).toEqual([
			expect.objectContaining({
				sessionId: "session-1",
				operation: "create",
				status: "stage-completed",
				stage: "ownership",
				durationMs: 12.34,
			}),
			expect.objectContaining({ status: "completed", totalDurationMs: 20 }),
		]);
		expect(Object.keys(observations[0]).sort()).toEqual(
			["durationMs", "operation", "sessionId", "stage", "status", "totalDurationMs"].sort(),
		);
	});

	it("records the failed phase and never lets observer failures alter initialization", async () => {
		let currentTime = 0;
		const observer = vi.fn(() => {
			throw new Error("logger failed");
		});
		const timeline = createCodingAgentSessionInitializationTimeline({
			sessionId: "session-2",
			operation: "resume",
			now: () => currentTime,
			observer,
		});

		await expect(
			timeline.measure("plugin-skills", async () => {
				currentTime = 7;
				throw new Error("skill loading failed");
			}),
		).rejects.toThrow("skill loading failed");
		currentTime = 9;
		expect(() => timeline.finish("failed")).not.toThrow();
		expect(observer).toHaveBeenLastCalledWith(
			expect.objectContaining({ status: "failed", failedStage: "plugin-skills", totalDurationMs: 9 }),
		);
	});
});
