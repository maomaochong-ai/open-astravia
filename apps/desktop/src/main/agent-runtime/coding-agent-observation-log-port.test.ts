import {
	CODING_AGENT_COMPACTION_PREFIRE_OBSERVATION,
	CODING_AGENT_LIFECYCLE_ISSUE_OBSERVATION,
	CODING_AGENT_PLUGIN_CONFIGURATION_OBSERVATION,
	CODING_AGENT_SESSION_ASSISTANCE_OBSERVATION,
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

	it("logs safe session assistance failures without prompt or error content", () => {
		const info = vi.fn();
		const warn = vi.fn();
		const port = createCodingAgentObservationLogPort({ info, warn });
		port.record({
			token: CODING_AGENT_SESSION_ASSISTANCE_OBSERVATION,
			context: { sessionId: "session-1" },
			timestamp: 1,
			payload: {
				operation: "title.generate",
				phase: "candidate-failed",
				modelProvider: "openai",
				modelId: "gpt-test",
				attempt: 1,
				durationMs: 15,
				failure: { category: "error", errorName: "SessionAssistanceModelError", errorCode: "RATE_LIMIT" },
			},
		});

		expect(warn).toHaveBeenCalledWith("coding session assistance issue", {
			operation: "title.generate",
			phase: "candidate-failed",
			sessionId: "session-1",
			modelProvider: "openai",
			modelId: "gpt-test",
			attempt: 1,
			durationMs: 15,
			errorName: "SessionAssistanceModelError",
			errorCode: "RATE_LIMIT",
		});
		expect(info).not.toHaveBeenCalled();
	});

	it("logs safe Plugin configuration failure metadata", () => {
		const info = vi.fn();
		const warn = vi.fn();
		const port = createCodingAgentObservationLogPort({ info, warn });
		port.record({
			token: CODING_AGENT_PLUGIN_CONFIGURATION_OBSERVATION,
			context: { sessionId: "session-1" },
			timestamp: 1,
			payload: {
				phase: "failed",
				source: "host",
				boundary: "turn",
				durationMs: 8,
				failure: { category: "error", errorName: "PluginConfigurationError", errorCode: "MCP_FAILED" },
			},
		});

		expect(warn).toHaveBeenCalledWith("coding plugin configuration failed", {
			phase: "failed",
			source: "host",
			boundary: "turn",
			sessionId: "session-1",
			durationMs: 8,
			errorName: "PluginConfigurationError",
			errorCode: "MCP_FAILED",
		});
		expect(info).not.toHaveBeenCalled();
	});

	it("logs only the completed half of a successful Plugin configuration chain", () => {
		const info = vi.fn();
		const warn = vi.fn();
		const port = createCodingAgentObservationLogPort({ info, warn });
		const context = { sessionId: "session-1" };
		port.record({
			token: CODING_AGENT_PLUGIN_CONFIGURATION_OBSERVATION,
			context,
			timestamp: 1,
			payload: { phase: "started", source: "host", boundary: "idle" },
		});
		port.record({
			token: CODING_AGENT_PLUGIN_CONFIGURATION_OBSERVATION,
			context,
			timestamp: 2,
			payload: { phase: "completed", source: "host", boundary: "idle", durationMs: 4 },
		});

		expect(info).toHaveBeenCalledOnce();
		expect(info).toHaveBeenCalledWith("coding plugin configuration", {
			phase: "completed",
			source: "host",
			boundary: "idle",
			sessionId: "session-1",
			durationMs: 4,
		});
		expect(warn).not.toHaveBeenCalled();
	});
});
