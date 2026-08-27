import {
	defineRuntimeObservation,
	RUNTIME_ACTIVE_SESSION_HOST_OBSERVATION,
	RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
	RUNTIME_HOST_AGENT_BACKEND_OBSERVATION,
	RUNTIME_HOST_LIFECYCLE_OBSERVATION,
	type RuntimeActiveSessionHostObservation,
	type RuntimeAgentLifecycleObservation,
	type RuntimeHostAgentBackendObservation,
	type RuntimeHostLifecycleObservation,
	type RuntimeObservationRecord,
} from "@vetta/runtime-core";
import { describe, expect, it, vi } from "vitest";
import { createRuntimeLifecycleLogPort } from "./runtime-lifecycle-log-port.js";

describe("runtime lifecycle log port", () => {
	it("logs revision, pool retirement and Session rebind as privacy-safe control-plane entries", () => {
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
				{ operation: "instance.pool.retire", phase: "completed", reason: "definition-revision" },
				{ agentId: "coding-agent", revisionId: "revision-1", instanceId: "instance-1" },
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
			operation: "instance.pool.retire",
			phase: "completed",
			agentId: "coding-agent",
			revisionId: "revision-1",
			instanceId: "instance-1",
			reason: "definition-revision",
		});
		expect(logger.info).toHaveBeenNthCalledWith(3, "runtime agent lifecycle", {
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

	it("logs dynamic main Agent admission without exposing configuration or error text", () => {
		const logger = { info: vi.fn(), warn: vi.fn() };
		const port = createRuntimeLifecycleLogPort(logger);

		port.record(
			agentBackendObservationRecord(
				{
					operation: "install",
					phase: "completed",
					backendRevisionId: "backend-1",
					sourceId: "plugin",
					sourceRevision: "2",
				},
				{ agentId: "reviewer", revisionId: "definition-1" },
			),
		);
		port.record(
			agentBackendObservationRecord(
				{
					operation: "backend.dispose",
					phase: "failed",
					backendRevisionId: "backend-1",
					failure: { category: "error", errorName: "CleanupError", errorCode: "E_CLEANUP" },
				},
				{ agentId: "reviewer" },
			),
		);

		expect(logger.info).toHaveBeenCalledWith("runtime host agent backend", {
			operation: "install",
			phase: "completed",
			agentId: "reviewer",
			definitionRevisionId: "definition-1",
			backendRevisionId: "backend-1",
			sourceId: "plugin",
			sourceRevision: "2",
		});
		expect(logger.warn).toHaveBeenCalledWith("runtime host agent backend failure", {
			operation: "backend.dispose",
			phase: "failed",
			agentId: "reviewer",
			backendRevisionId: "backend-1",
			failureCategory: "error",
			errorName: "CleanupError",
			errorCode: "E_CLEANUP",
		});
		expect(JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls])).not.toContain("message");
	});

	it("logs active Session transition failures through the same privacy-safe lifecycle adapter", () => {
		const logger = { info: vi.fn(), warn: vi.fn() };
		const port = createRuntimeLifecycleLogPort(logger);

		port.record(
			activeSessionObservationRecord(
				{
					operation: "transition.cleanup",
					phase: "failed",
					component: "retired-session",
					transitionKind: "resume",
					failure: { category: "error", errorName: "CleanupError", errorCode: "E_CLEANUP" },
				},
				{ sessionId: "session-2" },
			),
		);

		expect(logger.warn).toHaveBeenCalledWith("runtime active session lifecycle failure", {
			operation: "transition.cleanup",
			phase: "failed",
			component: "retired-session",
			transitionKind: "resume",
			sessionId: "session-2",
			failureCategory: "error",
			errorName: "CleanupError",
			errorCode: "E_CLEANUP",
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

function agentBackendObservationRecord(
	payload: RuntimeHostAgentBackendObservation,
	context: RuntimeObservationRecord["context"],
): RuntimeObservationRecord<RuntimeHostAgentBackendObservation> {
	return { token: RUNTIME_HOST_AGENT_BACKEND_OBSERVATION, context, timestamp: 1, payload };
}

function activeSessionObservationRecord(
	payload: RuntimeActiveSessionHostObservation,
	context: RuntimeObservationRecord["context"],
): RuntimeObservationRecord<RuntimeActiveSessionHostObservation> {
	return { token: RUNTIME_ACTIVE_SESSION_HOST_OBSERVATION, context, timestamp: 1, payload };
}
