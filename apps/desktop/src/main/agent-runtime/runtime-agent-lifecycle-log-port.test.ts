import {
	defineRuntimeObservation,
	RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
	type RuntimeAgentLifecycleObservation,
	type RuntimeObservationRecord,
} from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { createRuntimeAgentLifecycleLogPort } from "./runtime-agent-lifecycle-log-port.js";

describe("runtime agent lifecycle log port", () => {
	it("logs revision publication and Session rebind as privacy-safe control-plane entries", () => {
		const logger = { info: vi.fn(), warn: vi.fn() };
		const port = createRuntimeAgentLifecycleLogPort(logger);

		port.record(
			observationRecord(
				{
					operation: "revision.publish",
					phase: "completed",
					sourceId: "coding-agent.builtin",
					sourceRevision: "2",
					definitionCount: 1,
				},
				{ agentId: "coding-agent", revisionId: "revision-2" },
			),
		);
		port.record(
			observationRecord(
				{ operation: "session.rebind", phase: "completed" },
				{
					agentId: "coding-agent",
					revisionId: "revision-2",
					instanceId: "instance-1",
					sessionId: "canonical-session",
				},
			),
		);

		expect(logger.info).toHaveBeenNthCalledWith(1, "runtime agent lifecycle", {
			operation: "revision.publish",
			phase: "completed",
			agentId: "coding-agent",
			revisionId: "revision-2",
			sourceId: "coding-agent.builtin",
			sourceRevision: "2",
			definitionCount: 1,
		});
		expect(logger.info).toHaveBeenNthCalledWith(2, "runtime agent lifecycle", {
			operation: "session.rebind",
			phase: "completed",
			agentId: "coding-agent",
			revisionId: "revision-2",
			instanceId: "instance-1",
			sessionId: "canonical-session",
		});
		expect(logger.warn).not.toHaveBeenCalled();
	});

	it("logs every failure without exposing an error message or runtime payload", () => {
		const logger = { info: vi.fn(), warn: vi.fn() };
		const port = createRuntimeAgentLifecycleLogPort(logger);

		port.record(
			observationRecord(
				{
					operation: "session.create",
					phase: "failed",
					failure: { category: "error", errorName: "ProviderError", errorCode: "E_PROVIDER" },
				},
				{ agentId: "coding-agent", sessionId: "session-1" },
			),
		);

		expect(logger.warn).toHaveBeenCalledWith("runtime agent lifecycle failure", {
			operation: "session.create",
			phase: "failed",
			agentId: "coding-agent",
			sessionId: "session-1",
			failureCategory: "error",
			errorName: "ProviderError",
			errorCode: "E_PROVIDER",
		});
		expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("message");
	});

	it("ignores noisy successful data-plane events and unrelated observations", () => {
		const logger = { info: vi.fn(), warn: vi.fn() };
		const port = createRuntimeAgentLifecycleLogPort(logger);

		port.record(observationRecord({ operation: "session.create", phase: "completed" }, { sessionId: "session-1" }));
		port.record({ token: defineRuntimeObservation("other", "event"), context: {}, timestamp: 1, payload: {} });

		expect(logger.info).not.toHaveBeenCalled();
		expect(logger.warn).not.toHaveBeenCalled();
	});
});

function observationRecord(
	payload: RuntimeAgentLifecycleObservation,
	context: RuntimeObservationRecord["context"],
): RuntimeObservationRecord<RuntimeAgentLifecycleObservation> {
	return { token: RUNTIME_AGENT_LIFECYCLE_OBSERVATION, context, timestamp: 1, payload };
}
