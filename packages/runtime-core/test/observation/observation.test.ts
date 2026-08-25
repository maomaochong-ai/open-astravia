import { describe, expect, it, vi } from "vitest";
import {
	CompositeRuntimeObservationPort,
	createRuntimeObservationPublisher,
	defineRuntimeObservation,
	type RuntimeObservationRecord,
	runtimeObservationFailure,
} from "../../src/observation/index.js";

const TEST_OBSERVATION = defineRuntimeObservation<{ readonly value: number }>("test", "event");

describe("runtime observation", () => {
	it("binds identity scopes without allowing child contexts to replace parent identity", () => {
		const records: RuntimeObservationRecord[] = [];
		const publisher = createRuntimeObservationPublisher({
			port: {
				record: (record) => {
					records.push(record);
				},
			},
			now: () => 42,
			context: { agentId: "agent", revisionId: "revision" },
		});

		publisher
			.scope({ agentId: "other", instanceId: "instance" })
			.record(TEST_OBSERVATION, { value: 1 }, { sessionId: "session", instanceId: "other-instance" });

		expect(records).toEqual([
			{
				token: TEST_OBSERVATION,
				context: {
					sessionId: "session",
					instanceId: "instance",
					agentId: "agent",
					revisionId: "revision",
				},
				timestamp: 42,
				payload: { value: 1 },
			},
		]);
	});

	it("isolates synchronous and asynchronous adapter failures from observed work", async () => {
		const successfulRecords: RuntimeObservationRecord[] = [];
		const onPortError = vi.fn();
		const publisher = createRuntimeObservationPublisher({
			port: new CompositeRuntimeObservationPort([
				{ record: () => Promise.reject(new Error("async adapter secret")) },
				{
					record: () => {
						throw new Error("sync adapter secret");
					},
				},
				{
					record: (record) => {
						successfulRecords.push(record);
					},
				},
			]),
			onPortError,
		});

		expect(() => publisher.record(TEST_OBSERVATION, { value: 2 })).not.toThrow();
		await publisher.flush();
		expect(successfulRecords).toHaveLength(1);
		expect(onPortError).not.toHaveBeenCalled();
	});

	it("projects failures without messages, stacks or arbitrary error properties", () => {
		const error = Object.assign(new Error("credential=secret"), {
			code: "E_SAFE",
			requestBody: "secret request",
		});

		expect(runtimeObservationFailure(error)).toEqual({
			category: "error",
			errorName: "Error",
			errorCode: "E_SAFE",
		});
		expect(JSON.stringify(runtimeObservationFailure(error))).not.toContain("secret");
	});
});
