import { describe, expect, it, vi } from "vitest";
import { createSessionInitializationLogObserver } from "./session-initialization-log-observer.js";

describe("session initialization log observer", () => {
	it("aggregates stage observations into one privacy-safe completion record", () => {
		const logger = { info: vi.fn(), warn: vi.fn() };
		const observe = createSessionInitializationLogObserver(logger);

		observe({
			sessionId: "session-1",
			operation: "create",
			status: "stage-completed",
			stage: "plugin-skills",
			durationMs: 123.456,
			totalDurationMs: 130,
		});
		observe({
			sessionId: "session-1",
			operation: "create",
			status: "completed",
			durationMs: 150.01,
			totalDurationMs: 150.01,
		});

		expect(logger.info).toHaveBeenCalledOnce();
		expect(logger.info).toHaveBeenCalledWith("session initialization trace", {
			sessionId: "session-1",
			operation: "create",
			status: "completed",
			totalDurationMs: 150,
			stages: { "plugin-skills": { durationMs: 123.5, status: "completed" } },
		});
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("logs failed initializations at warning level with the failed stage", () => {
		const logger = { info: vi.fn(), warn: vi.fn() };
		const observe = createSessionInitializationLogObserver(logger);
		observe({
			sessionId: "session-2",
			operation: "resume",
			status: "stage-failed",
			stage: "initial-system-prompt",
			durationMs: 4,
			totalDurationMs: 8,
		});
		observe({
			sessionId: "session-2",
			operation: "resume",
			status: "failed",
			failedStage: "initial-system-prompt",
			durationMs: 9,
			totalDurationMs: 9,
		});

		expect(logger.warn).toHaveBeenCalledWith(
			"session initialization trace",
			expect.objectContaining({ status: "failed", failedStage: "initial-system-prompt" }),
		);
	});
});
