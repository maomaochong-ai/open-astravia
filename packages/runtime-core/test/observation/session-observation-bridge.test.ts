import { describe, expect, it } from "vitest";
import {
	createRuntimeObservationPublisher,
	projectRuntimeSessionObservation,
	publishRuntimeSessionObservation,
	RUNTIME_SESSION_OBSERVATION_SUMMARY,
	type RuntimeObservationRecord,
} from "../../src/observation/index.js";

describe("Runtime Session observation bridge", () => {
	it("projects content-bearing Session events to structural summaries", () => {
		const summaries = [
			projectRuntimeSessionObservation({
				type: "message.delta",
				source: "agent",
				delta: "private message",
			}),
			projectRuntimeSessionObservation({
				type: "tool.start",
				source: "tool",
				toolCallId: "call-1",
				toolName: "review",
				args: { credential: "secret-tool-argument" },
				startedAt: 10,
			}),
			projectRuntimeSessionObservation({
				type: "session.extension",
				source: "runtime-core",
				extensionId: "todo",
				event: "updated",
				payload: { text: "secret-extension-payload" },
			}),
		];

		expect(summaries).toEqual([
			{ eventType: "message.delta", source: "agent", characterCount: 15 },
			{ eventType: "tool.start", source: "tool", toolName: "review", startedAt: 10 },
			{
				eventType: "session.extension",
				source: "runtime-core",
				extensionId: "todo",
				extensionEvent: "updated",
			},
		]);
		expect(JSON.stringify(summaries)).not.toContain("secret");
		expect(JSON.stringify(summaries)).not.toContain("private message");
	});

	it("publishes safe failure fields with inherited Session and Turn identity", () => {
		const records: RuntimeObservationRecord[] = [];
		const publisher = createRuntimeObservationPublisher({
			context: { traceId: "trace-1" },
			port: {
				record: (record) => {
					records.push(record);
				},
			},
		});

		publishRuntimeSessionObservation(
			publisher,
			{
				type: "error",
				source: "agent",
				turnId: "turn-1",
				error: {
					code: "RATE_LIMITED",
					message: "credential=secret-error-message",
					retryable: true,
					origin: "provider",
					details: { responseBodyPreview: "secret-provider-body" },
				},
			},
			{ sessionId: "session-1" },
		);

		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			token: RUNTIME_SESSION_OBSERVATION_SUMMARY,
			context: { traceId: "trace-1", sessionId: "session-1", turnId: "turn-1" },
			payload: {
				eventType: "error",
				source: "agent",
				failure: { code: "RATE_LIMITED", origin: "provider", retryable: true },
			},
		});
		expect(JSON.stringify(records)).not.toContain("secret");
	});
});
