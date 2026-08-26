import { describe, expect, it } from "vitest";
import type { RuntimeAgentDefinition, RuntimeAgentLifecycleObservation } from "../../src/agents/index.js";
import { RUNTIME_AGENT_LIFECYCLE_OBSERVATION, RuntimeAgentRuntime } from "../../src/agents/index.js";
import { PassthroughContextStrategy } from "../../src/kernel/index.js";
import { RuntimeObservationHub, type RuntimeObservationRecord } from "../../src/observation/index.js";
import { RuntimeAgentInstancePool } from "../../src/runtime-host/runtime-agent-instance-pool.js";

describe("RuntimeAgentInstancePool", () => {
	it("reuses one generation and retires it on Definition or configuration revision changes", async () => {
		const runtime = new RuntimeAgentRuntime();
		runtime.registry.upsert({ source: { id: "code", revision: "1" }, definition: definition("agent", "v1") });
		const pool = new RuntimeAgentInstancePool({ runtime });

		const [first, concurrent] = await Promise.all([
			pool.acquire({ id: "agent", instanceKey: "workspace", instanceConfigurationRevision: "settings-1" }),
			pool.acquire({ id: "agent", instanceKey: "workspace", instanceConfigurationRevision: "settings-1" }),
		]);
		expect(concurrent.instance).toBe(first.instance);

		runtime.registry.upsert({ source: { id: "code", revision: "2" }, definition: definition("agent", "v2") });
		const nextDefinition = await pool.acquire({
			id: "agent",
			instanceKey: "workspace",
			instanceConfigurationRevision: "settings-1",
		});
		expect(nextDefinition.instance).not.toBe(first.instance);
		expect(nextDefinition.instance.revisionId).not.toBe(first.instance.revisionId);

		const nextConfiguration = await pool.acquire({
			id: "agent",
			instanceKey: "workspace",
			instanceConfiguration: { setting: true },
			instanceConfigurationRevision: "settings-2",
		});
		expect(nextConfiguration.instance).not.toBe(nextDefinition.instance);

		await first.release();
		await concurrent.release();
		await nextDefinition.release();
		await nextConfiguration.release();
		await pool.dispose();
		expect(runtime.snapshot().instances).toEqual([]);
		await runtime.close();
	});

	it("requires an explicit configuration revision before sharing unknown configuration", async () => {
		const runtime = new RuntimeAgentRuntime();
		runtime.registry.upsert({ source: { id: "code", revision: "1" }, definition: definition("agent", "v1") });
		const pool = new RuntimeAgentInstancePool({ runtime });

		await expect(
			pool.acquire({ id: "agent", instanceKey: "workspace", instanceConfiguration: { setting: true } }),
		).rejects.toThrow("requires instanceConfigurationRevision");
		expect(runtime.snapshot().instances).toEqual([]);

		await pool.dispose();
		await runtime.close();
	});

	it("keeps an explicitly pinned Composition generation stable until it is retired", async () => {
		const runtime = new RuntimeAgentRuntime();
		const firstPublication = runtime.registry.upsert({
			source: { id: "code", revision: "1" },
			definition: definition("agent", "v1"),
		});
		const pool = new RuntimeAgentInstancePool({ runtime });
		const prepared = await pool.acquire({ id: "agent", instanceKey: "composition" });
		const pinnedRevisionId = prepared.instance.revisionId;
		await prepared.release();

		runtime.registry.upsert({ source: { id: "code", revision: "2" }, definition: definition("agent", "v2") });
		const pinned = await pool.acquire({
			id: "agent",
			instanceKey: "composition",
			definitionRevisionId: pinnedRevisionId,
		});
		expect(pinned.instance.revisionId).toBe(firstPublication.revision.id);

		await pinned.release();
		await pool.dispose();
		await runtime.close();
	});

	it("routes Instance and Session lifecycle through a module Hub and its parent", async () => {
		const parentRecords: RuntimeObservationRecord[] = [];
		const localRecords: RuntimeObservationRecord[] = [];
		const hub = new RuntimeObservationHub({
			parent: {
				record: (record) => {
					parentRecords.push(record);
				},
			},
		});
		hub.attach(
			{
				record: (record) => {
					localRecords.push(record);
				},
			},
			{ id: "local" },
		);
		const runtime = new RuntimeAgentRuntime();
		runtime.registry.upsert({ source: { id: "code", revision: "1" }, definition: definition("agent", "v1") });
		const pool = new RuntimeAgentInstancePool({ runtime, observationPublisher: hub.publisher() });

		const lease = await pool.acquire({ id: "agent", instanceKey: "composition" });
		const session = await lease.instance.createSession({ sessionId: "session" });
		await session.close();
		await lease.release();
		await pool.dispose();
		await hub.close();

		const localLifecycle = localRecords.filter(isAgentLifecycleObservation);
		expect(localLifecycle.map(({ payload }) => payload.operation)).toEqual(
			expect.arrayContaining([
				"instance.create",
				"session.create",
				"session.close",
				"instance.pool.retire",
				"instance.close",
			]),
		);
		expect(parentRecords).toEqual(expect.arrayContaining(localLifecycle));
		expect(localLifecycle.every((record) => parentRecords.includes(record))).toBe(true);
		await runtime.close();
	});
});

function isAgentLifecycleObservation(
	record: RuntimeObservationRecord,
): record is RuntimeObservationRecord<RuntimeAgentLifecycleObservation> {
	return record.token === RUNTIME_AGENT_LIFECYCLE_OBSERVATION;
}

function definition(id: string, instruction: string): RuntimeAgentDefinition {
	return {
		id,
		createInstance: () => ({
			prepareSession: () => ({
				capabilities: {
					instructions: [{ id: "base", content: instruction, priority: 0 }],
					features: [],
					contextStrategy: new PassthroughContextStrategy(),
					toolPolicy: { authorize: async () => true },
					tokenBudget: 8_000,
					reservedOutputTokens: 1_000,
				},
			}),
		}),
	};
}
