import {
	RUNTIME_TURN_RETRY_ISSUE_OBSERVATION,
	RUNTIME_TURN_RETRY_LIFECYCLE_OBSERVATION,
	type RuntimeObservationRecord,
} from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { createRuntimeRetryLogPort } from "./runtime-retry-log-port.js";

describe("createRuntimeRetryLogPort", () => {
	it("logs only safe retry lifecycle fields", () => {
		const logger = { info: vi.fn(), warn: vi.fn() };
		const port = createRuntimeRetryLogPort(logger);
		const record: RuntimeObservationRecord = {
			token: RUNTIME_TURN_RETRY_LIFECYCLE_OBSERVATION,
			context: { agentId: "coding-agent", sessionId: "session-1", turnId: "turn-1" },
			timestamp: 1,
			payload: {
				phase: "scheduled",
				attempt: 1,
				maxAttempts: 3,
				delayMs: 2_000,
				failureCode: "AI_RATE_LIMITED",
				failureOrigin: "provider",
			},
		};

		port.record(record);

		expect(logger.info).toHaveBeenCalledWith("runtime turn retry", {
			phase: "scheduled",
			attempt: 1,
			agentId: "coding-agent",
			sessionId: "session-1",
			turnId: "turn-1",
			maxAttempts: 3,
			delayMs: 2_000,
			failureCode: "AI_RATE_LIMITED",
			failureOrigin: "provider",
		});
		expect(JSON.stringify(logger.info.mock.calls)).not.toContain("message");
	});

	it("logs retry stop reasons as warnings", () => {
		const logger = { info: vi.fn(), warn: vi.fn() };
		const port = createRuntimeRetryLogPort(logger);

		port.record({
			token: RUNTIME_TURN_RETRY_ISSUE_OBSERVATION,
			context: { sessionId: "session-1" },
			timestamp: 1,
			payload: {
				reason: "retry-after-exceeds-max-delay",
				attempt: 0,
				failureCode: "AI_RATE_LIMITED",
				failureOrigin: "provider",
			},
		});

		expect(logger.warn).toHaveBeenCalledWith("runtime turn retry issue", {
			reason: "retry-after-exceeds-max-delay",
			attempt: 0,
			sessionId: "session-1",
			failureCode: "AI_RATE_LIMITED",
			failureOrigin: "provider",
		});
	});
});
