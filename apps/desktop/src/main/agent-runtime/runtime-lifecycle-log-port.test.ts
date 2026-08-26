import {
	defineRuntimeObservation,
	RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
	RUNTIME_HOST_LIFECYCLE_OBSERVATION,
	type RuntimeAgentLifecycleObservation,
	type RuntimeHostLifecycleObservation,
	type RuntimeObservationRecord,
} from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { createRuntimeLifecycleLogPort } from "./runtime-lifecycle-log-port.js";

describe("runtime lifecycle log port", () => {
	it("logs revision publication and Session rebind as privacy-safe control-plane entries", () => {
		const logger = { info: vi.fn(), warn: vi.fn() };
		const port = createRuntimeLifecycleLogPort(logger);

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
		const port = createRuntimeLifecycleLogPort(logger);

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

	it("logs Host cleanup failures and completion through the same port", () => {
		const logger = { info: vi.fn(), warn: vi.fn() };
		const port = createRuntimeLifecycleLogPort(logger);

		port.record(
			hostObservationRecord(
				{
					operation: "session.dispose",
					phase: "failed",
					component: "sessions",
					failure: { category: "error", errorName: "CleanupError", errorCode: "E_CLEANUP" },
				},
				{ sessionId: "session-1" },
			),
		);
		port.record(hostObservationRecord({ operation: "host.close", phase: "completed" }, {}));

		expect(logger.warn).toHaveBeenCalledWith("runtime host lifecycle failure", {
			operation: "session.dispose",
			phase: "failed",
			component: "sessions",
			sessionId: "session-1",
			failureCategory: "error",
			errorName: "CleanupError",
			errorCode: "E_CLEANUP",
		});
		expect(logger.info).toHaveBeenCalledWith("runtime host lifecycle", {
			operation: "host.close",
			phase: "completed",
		});
		expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("message");
	});

	it("ignores noisy successful data-plane events and unrelated observations", () => {
		const logger = { info: vi.fn(), warn: vi.fn() };
		const port = createRuntimeLifecycleLogPort(logger);

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

function hostObservationRecord(
	payload: RuntimeHostLifecycleObservation,
	context: RuntimeObservationRecord["context"],
): RuntimeObservationRecord<RuntimeHostLifecycleObservation> {
	return { token: RUNTIME_HOST_LIFECYCLE_OBSERVATION, context, timestamp: 1, payload };
}
