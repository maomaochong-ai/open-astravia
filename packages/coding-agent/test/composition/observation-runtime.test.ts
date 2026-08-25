import {
	createRuntimeObservationPublisher,
	defineRuntimeObservation,
	RuntimeObservationHub,
	type RuntimeObservationRecord,
} from "@vetta/runtime-core";
import { describe, expect, it } from "vitest";
import {
	createChildCodingAgentObservationOptions,
	createCodingAgentObservationRuntime,
} from "../../src/composition/observability/observation-runtime.js";

const TEST_OBSERVATION = defineRuntimeObservation<{ readonly value: number }>("coding-agent.test", "event");

describe("Coding Agent observation runtime", () => {
	it("routes the same record to local adapters and the parent Hub", async () => {
		const parentRecords: RuntimeObservationRecord[] = [];
		const localRecords: RuntimeObservationRecord[] = [];
		const parent = new RuntimeObservationHub();
		parent.attach(
			{
				record: (record) => {
					parentRecords.push(record);
				},
			},
			{ id: "parent-recorder" },
		);
		const runtime = createCodingAgentObservationRuntime({
			hub: {
				parent,
				routes: [
					{
						port: {
							record: (record) => {
								localRecords.push(record);
							},
						},
						route: { id: "local-recorder", domains: [TEST_OBSERVATION.domain] },
					},
				],
			},
		});

		runtime.publisher.record(TEST_OBSERVATION, { value: 1 }, { sessionId: "session" });
		await runtime.hub.flush();

		expect(parentRecords).toHaveLength(1);
		expect(localRecords).toHaveLength(1);
		expect(parentRecords[0]).toBe(localRecords[0]);
		expect(parentRecords[0]?.context).toEqual({ sessionId: "session" });
		expect(runtime.hub.snapshot()).toMatchObject({
			adapterIds: ["local-recorder"],
			publishedRecordCount: 1,
			routedDeliveryCount: 2,
		});

		await runtime.hub.close();
		expect(runtime.hub.snapshot().closed).toBe(true);
		expect(parent.snapshot().closed).toBe(false);
		parent.publisher().record(TEST_OBSERVATION, { value: 2 });
		await parent.flush();
		expect(parentRecords).toHaveLength(2);
	});

	it("bridges a scoped Publisher without changing timestamp or parent identity", async () => {
		const upstreamRecords: RuntimeObservationRecord[] = [];
		const localRecords: RuntimeObservationRecord[] = [];
		const upstreamPublisher = createRuntimeObservationPublisher({
			port: {
				record: (record) => {
					upstreamRecords.push(record);
				},
			},
			context: { agentId: "coding-agent", revisionId: "revision" },
			now: () => 999,
		});
		const runtime = createCodingAgentObservationRuntime({
			publisher: upstreamPublisher,
			hub: {
				routes: [
					{
						port: {
							record: (record) => {
								localRecords.push(record);
							},
						},
						route: { id: "local" },
					},
				],
			},
		});

		runtime.publisher.record(TEST_OBSERVATION, { value: 1 }, { agentId: "cannot-override", sessionId: "session" });
		await runtime.hub.flush();

		expect(upstreamRecords).toHaveLength(1);
		expect(localRecords).toHaveLength(1);
		expect(upstreamRecords[0]?.timestamp).toBe(localRecords[0]?.timestamp);
		expect(upstreamRecords[0]?.context).toEqual({
			agentId: "coding-agent",
			revisionId: "revision",
			sessionId: "session",
		});
	});

	it("rejects duplicate upstreams and nests child Compositions without duplicating local routes", () => {
		const parent = new RuntimeObservationHub();
		const publisher = parent.publisher();
		expect(() => createCodingAgentObservationRuntime({ publisher, hub: { parent } })).toThrow(
			"either a parent Port or Publisher",
		);

		const localPort = { record() {} };
		const onIssue = () => {};
		const child = createChildCodingAgentObservationOptions(
			{
				parent: { record() {} },
				routes: [{ port: localPort, route: { id: "parent-local" } }],
				maxPendingRecords: 10,
				onIssue,
			},
			parent,
		);
		expect(child).toEqual({ parent, maxPendingRecords: 10, onIssue });
	});
});
