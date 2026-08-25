import {
	CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION,
	type CodingAgentSessionInitializationObservation,
} from "@vetta/coding-agent/composition";
import { defineRuntimeObservation, type RuntimeObservationRecord } from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { createSessionInitializationLogPort } from "./session-initialization-log-port.js";

describe("session initialization log port", () => {
	it("aggregates stage observations into one privacy-safe completion record", () => {
		const logger = { info: vi.fn(), warn: vi.fn() };
		const port = createSessionInitializationLogPort(logger);

		port.record(
			observationRecord("session-1", {
				operation: "create",
				status: "stage-completed",
				stage: "plugin-skills",
				durationMs: 123.456,
				totalDurationMs: 130,
			}),
		);
		port.record(
			observationRecord("session-1", {
				operation: "create",
				status: "completed",
				durationMs: 150.01,
				totalDurationMs: 150.01,
			}),
		);

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
		const port = createSessionInitializationLogPort(logger);
		port.record(
			observationRecord("session-2", {
				operation: "resume",
				status: "stage-failed",
				stage: "initial-system-prompt",
				durationMs: 4,
				totalDurationMs: 8,
			}),
		);
		port.record(
			observationRecord("session-2", {
				operation: "resume",
				status: "failed",
				failedStage: "initial-system-prompt",
				durationMs: 9,
				totalDurationMs: 9,
			}),
		);

		expect(logger.warn).toHaveBeenCalledWith(
			"session initialization trace",
			expect.objectContaining({ status: "failed", failedStage: "initial-system-prompt" }),
		);
	});

	it("is standalone and ignores unrelated tokens or records without Session identity", () => {
		const logger = { info: vi.fn(), warn: vi.fn() };
		const port = createSessionInitializationLogPort(logger);
		port.record({
			token: defineRuntimeObservation("other", "event"),
			context: { sessionId: "session-3" },
			timestamp: 1,
			payload: {},
		});
		port.record(
			observationRecord(undefined, {
				operation: "create",
				status: "completed",
				durationMs: 1,
				totalDurationMs: 1,
			}),
		);

		expect(logger.info).not.toHaveBeenCalled();
		expect(logger.warn).not.toHaveBeenCalled();
	});
});

function observationRecord(
	sessionId: string | undefined,
	payload: CodingAgentSessionInitializationObservation,
): RuntimeObservationRecord<CodingAgentSessionInitializationObservation> {
	return {
		token: CODING_AGENT_SESSION_INITIALIZATION_OBSERVATION,
		context: sessionId ? { sessionId } : {},
		timestamp: 1,
		payload,
	};
}
