import { describe, expect, it, vi } from "vitest";
import {
	CompositeRuntimeObservationPort,
	createRuntimeObservationPublisher,
	createRuntimeObservationPublisherPort,
	defineRuntimeObservation,
	RUNTIME_OBSERVATION_HUB_ISSUE,
	RuntimeObservationHub,
	type RuntimeObservationRecord,
	runtimeObservationFailure,
} from "../../src/observation/index.js";

const TEST_OBSERVATION = defineRuntimeObservation<{ readonly value: number }>("test", "event");
const OTHER_OBSERVATION = defineRuntimeObservation<{ readonly value: number }>("other", "event", "debug");

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

	it("forwards child records through a scoped Publisher without rebuilding their timestamp", async () => {
		const records: RuntimeObservationRecord[] = [];
		const upstream = createRuntimeObservationPublisher({
			port: {
				record: (record) => {
					records.push(record);
				},
			},
			context: { agentId: "agent", revisionId: "revision" },
			now: () => 999,
		});
		const port = createRuntimeObservationPublisherPort(upstream);
		const childRecord: RuntimeObservationRecord<{ readonly value: number }> = Object.freeze({
			token: TEST_OBSERVATION,
			context: Object.freeze({ agentId: "untrusted", sessionId: "session" }),
			timestamp: 42,
			payload: Object.freeze({ value: 1 }),
		});

		await port.record(childRecord);
		await port.flush?.();

		expect(records).toEqual([
			{
				token: TEST_OBSERVATION,
				context: { agentId: "agent", revisionId: "revision", sessionId: "session" },
				timestamp: 42,
				payload: { value: 1 },
			},
		]);
	});

	it("isolates forwarded record failures from a child Hub", () => {
		const onPortError = vi.fn();
		const publisher = createRuntimeObservationPublisher({
			port: {
				record() {
					throw new Error("forwarded adapter secret");
				},
			},
			onPortError,
		});
		const record: RuntimeObservationRecord = {
			token: TEST_OBSERVATION,
			context: {},
			timestamp: 42,
			payload: { value: 1 },
		};

		expect(() => publisher.forward(record)).not.toThrow();
		expect(onPortError).toHaveBeenCalledOnce();
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

	it("aggregates a standalone child Hub into its parent while preserving local routes", async () => {
		const rootRecords: RuntimeObservationRecord[] = [];
		const localRecords: RuntimeObservationRecord[] = [];
		const root = new RuntimeObservationHub({ now: () => 42 });
		root.attach(
			{
				record: (record) => {
					rootRecords.push(record);
				},
			},
			{ id: "root" },
		);
		const child = new RuntimeObservationHub({ parent: root, now: () => 42 });
		const local = child.attach(
			{
				record: (record) => {
					localRecords.push(record);
				},
			},
			{ id: "local-test", domains: ["test"] },
		);
		const publisher = child.publisher({ agentId: "agent", sessionId: "session" });

		publisher.record(TEST_OBSERVATION, { value: 1 });
		publisher.record(OTHER_OBSERVATION, { value: 2 });
		await child.flush();

		expect(rootRecords.map(({ token }) => token.id)).toEqual(["test.event", "other.event"]);
		expect(localRecords.map(({ token }) => token.id)).toEqual(["test.event"]);
		expect(rootRecords[0]?.context).toEqual({ agentId: "agent", sessionId: "session" });
		expect(rootRecords[0]?.timestamp).toBe(42);
		expect(child.snapshot()).toMatchObject({
			adapterIds: ["local-test"],
			publishedRecordCount: 2,
			routedDeliveryCount: 3,
			filteredDeliveryCount: 1,
			deliveryFailureCount: 0,
			droppedRecordCount: 0,
			pendingRecordCount: 0,
		});

		expect(local.detach()).toBe(true);
		expect(local.detach()).toBe(false);
		publisher.record(TEST_OBSERVATION, { value: 3 });
		await child.flush();
		expect(rootRecords).toHaveLength(3);
		expect(localRecords).toHaveLength(1);
	});

	it("isolates route failures and reports safe Hub diagnostics to healthy adapters", async () => {
		const records: RuntimeObservationRecord[] = [];
		const issues: unknown[] = [];
		const hub = new RuntimeObservationHub({ onIssue: (issue) => issues.push(issue) });
		hub.attach(
			{
				record: () => Promise.reject(new Error("adapter credential=secret")),
				flush: () => Promise.reject(new Error("flush credential=secret")),
			},
			{ id: "failing" },
		);
		hub.attach(
			{
				record: (record) => {
					records.push(record);
				},
			},
			{ id: "healthy" },
		);

		hub.publisher().record(TEST_OBSERVATION, { value: 1 });
		await hub.flush();

		expect(records[0]?.token).toBe(TEST_OBSERVATION);
		const diagnostics = records.filter(({ token }) => token === RUNTIME_OBSERVATION_HUB_ISSUE);
		expect(diagnostics.map(({ payload }) => (payload as { operation: string }).operation)).toEqual([
			"adapter.record",
			"adapter.flush",
		]);
		expect(hub.snapshot().deliveryFailureCount).toBe(2);
		expect(issues).toHaveLength(2);
		expect(JSON.stringify({ diagnostics, issues })).not.toContain("credential=secret");
	});

	it("bounds pending records, reports drops and closes idempotently", async () => {
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const issues: unknown[] = [];
		const hub = new RuntimeObservationHub({ maxPendingRecords: 1, onIssue: (issue) => issues.push(issue) });
		const slowRecord = vi.fn(() => blocked);
		hub.attach({ record: slowRecord }, { id: "slow" });
		const first = hub.record({ token: TEST_OBSERVATION, context: {}, timestamp: 1, payload: { value: 1 } });
		const dropped = hub.record({ token: TEST_OBSERVATION, context: {}, timestamp: 2, payload: { value: 2 } });

		expect(hub.snapshot()).toMatchObject({ publishedRecordCount: 1, droppedRecordCount: 1 });
		expect(issues).toContainEqual({ operation: "hub.capacity", phase: "dropped" });
		expect(slowRecord).toHaveBeenCalledOnce();
		release();
		await Promise.all([first, dropped]);
		const closing = hub.close();
		expect(hub.close()).toBe(closing);
		await closing;
		await hub.record({ token: TEST_OBSERVATION, context: {}, timestamp: 3, payload: { value: 3 } });
		expect(hub.snapshot()).toMatchObject({ closed: true, droppedRecordCount: 2, pendingRecordCount: 0 });
		expect(issues).toContainEqual({ operation: "hub.closed", phase: "dropped" });
		expect(slowRecord).toHaveBeenCalledOnce();
		expect(() => hub.attach({ record() {} }, { id: "late" })).toThrow("Runtime observation hub is closed");
	});
});
