import {
	CODING_AGENT_COMPACTION_PREFIRE_OBSERVATION,
	CODING_AGENT_LIFECYCLE_ISSUE_OBSERVATION,
	CODING_AGENT_SUBAGENT_ISSUE_OBSERVATION,
} from "@vetta/coding-agent/composition";
import { describe, expect, it, vi } from "vitest";
import { createCodingAgentObservationLogPort } from "./coding-agent-observation-log-port.js";

describe("createCodingAgentObservationLogPort", () => {
	it("logs safe prefire failure metadata without error content", () => {
		const info = vi.fn();
		const warn = vi.fn();
		const port = createCodingAgentObservationLogPort({ info, warn });
		port.record({
			token: CODING_AGENT_COMPACTION_PREFIRE_OBSERVATION,
			context: { sessionId: "session-1" },
			timestamp: 1,
			payload: {
				phase: "failed",
				failure: { category: "error", errorName: "ProviderError", errorCode: "RATE_LIMIT" },
			},
		});

		expect(warn).toHaveBeenCalledWith("coding context compaction prefire failed", {
			phase: "failed",
			sessionId: "session-1",
			errorName: "ProviderError",
			errorCode: "RATE_LIMIT",
		});
		expect(info).not.toHaveBeenCalled();
	});

	it("logs safe subagent issue fields", () => {
		const info = vi.fn();
		const warn = vi.fn();
		const port = createCodingAgentObservationLogPort({ info, warn });
		port.record({
			token: CODING_AGENT_SUBAGENT_ISSUE_OBSERVATION,
			context: { sessionId: "session-1" },
			timestamp: 1,
			payload: {
				operation: "coordinator",
				failure: { category: "error", errorName: "ChildError", errorCode: "CHILD_FAILED" },
			},
		});

		expect(warn).toHaveBeenCalledWith("coding subagent issue", {
			operation: "coordinator",
			sessionId: "session-1",
			failureCategory: "error",
			errorName: "ChildError",
			errorCode: "CHILD_FAILED",
		});
	});

	it("logs safe lifecycle issue fields", () => {
		const info = vi.fn();
		const warn = vi.fn();
		const port = createCodingAgentObservationLogPort({ info, warn });
		port.record({
			token: CODING_AGENT_LIFECYCLE_ISSUE_OBSERVATION,
			context: { sessionId: "session-1" },
			timestamp: 1,
			payload: {
				operation: "session-end-hook",
				cause: "dispose",
				failure: { category: "error", errorName: "HookError" },
			},
		});

		expect(warn).toHaveBeenCalledWith("coding agent lifecycle issue", {
			operation: "session-end-hook",
			cause: "dispose",
			sessionId: "session-1",
			failureCategory: "error",
			errorName: "HookError",
		});
	});
});
