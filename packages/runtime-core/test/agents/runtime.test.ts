import { describe, expect, it, vi } from "vitest";
import {
	RUNTIME_AGENT_ERROR_CODES,
	RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
	type RuntimeAgentDefinition,
	type RuntimeAgentLifecycleObservation,
	RuntimeAgentRegistry,
	RuntimeAgentRuntime,
} from "../../src/agents/index.js";
import {
	type AgentFeatureDefinition,
	PassthroughContextStrategy,
	type RuntimeCapabilityDefinition,
	resolveModelCallFrame,
} from "../../src/kernel/index.js";
import type { RuntimeObservationRecord } from "../../src/observation/index.js";
import type { SessionExtensionDefinition } from "../../src/session-extensions/index.js";

describe("Runtime Agent control plane", () => {
	it("runs the Plan snapshot boundary before the single Agent Session provider acquires a generation", async () => {
		const events: string[] = [];
		const registry = registryWithIds();
		registry.upsert(
			candidate("code", "1", {
				id: "agent",
				createInstance: () => ({
					prepareSession: () => ({
						definition: { capabilities: capabilities("v1") },
						beforeSnapshotAcquire: () => {
							events.push("before");
						},
					}),
				}),
			}),
		);
		const host = new RuntimeAgentRuntime({ registry });
		const instance = await host.createInstance({ agentId: "agent" });
		const session = await instance.createSession();

		const lease = await session.acquire();
		events.push("acquired");

		expect(events).toEqual(["before", "acquired"]);
		await lease.release();
		await host.close();
		await registry.close();
	});

	it("routes multiple peer Agents, Instances and isolated Sessions", async () => {
		const lifecycle: string[] = [];
		const registry = registryWithIds();
		registry.upsert(candidate("code", "1", agentDefinition("writer", "write-v1", lifecycle)));
		registry.upsert(candidate("code", "1", agentDefinition("reviewer", "review-v1", lifecycle)));
		const host = new RuntimeAgentRuntime({ registry });
		const writer = await host.createInstance({ agentId: "writer", instanceId: "writer-instance" });
		const reviewer = await host.createInstance({ agentId: "reviewer", instanceId: "reviewer-instance" });
		const writerSession = await host.createSession(writer.id, { sessionId: "writer-session" });
		const reviewerSession = await host.createSession(reviewer.id, { sessionId: "reviewer-session" });

		const writerLease = await writerSession.acquire(turnContext("writer-session", "writer-turn"));
		const reviewerLease = await reviewerSession.acquire(turnContext("reviewer-session", "reviewer-turn"));
		expect(writerLease.snapshot.instructions[0]?.content).toBe("write-v1");
		expect(reviewerLease.snapshot.instructions[0]?.content).toBe("review-v1");
		expect(host.requireSession("writer-session")).toBe(writerSession);
		expect(host.snapshot().instances).toEqual([
			{ id: "reviewer-instance", agentId: "reviewer", revisionId: "revision-2", sessionIds: ["reviewer-session"] },
			{ id: "writer-instance", agentId: "writer", revisionId: "revision-1", sessionIds: ["writer-session"] },
		]);

		await writerLease.release();
		await reviewerLease.release();
		await host.close();
		expect(host.getSession("writer-session")).toBeUndefined();
		expect(host.getInstance("writer-instance")).toBeUndefined();
		await registry.close();
		expect(lifecycle).toContain("definition:write-v1:dispose");
		expect(lifecycle).toContain("definition:review-v1:dispose");
	});

	it("pins existing Instances by default and rolls one Session over at the next Turn boundary", async () => {
		const lifecycle: string[] = [];
		const registry = registryWithIds();
		registry.upsert(candidate("code", "1", agentDefinition("agent", "v1", lifecycle)));
		const host = new RuntimeAgentRuntime({ registry });
		const oldInstance = await host.createInstance({
			agentId: "agent",
			instanceId: "instance-old",
			configuration: { instance: "stable" },
		});
		const session = await host.createSession(oldInstance.id, {
			sessionId: "session-old",
			configuration: { session: "stable" },
		});
		const oldTurn = await session.acquire(turnContext(session.id, "turn-old"));

		registry.upsert(candidate("code", "2", agentDefinition("agent", "v2", lifecycle)));
		const stillOld = await host.createSession(oldInstance.id, { sessionId: "session-still-old" });
		const stillOldLease = await stillOld.acquire(turnContext(stillOld.id, "turn-still-old"));
		expect(stillOldLease.snapshot.instructions[0]?.content).toBe("v1");

		const newInstance = await host.createInstance({ agentId: "agent", instanceId: "instance-new" });
		const newSession = await host.createSession(newInstance.id, { sessionId: "session-new" });
		const newInstanceLease = await newSession.acquire(turnContext(newSession.id, "turn-new-instance"));
		expect(newInstanceLease.snapshot.instructions[0]?.content).toBe("v2");

		await expect(session.rolloutToLatest()).resolves.toMatchObject({
			status: "applied",
			revisionId: "revision-2",
		});
		const rolledTurn = await session.acquire(turnContext(session.id, "turn-rolled"));
		const oldFrame = await resolveModelCallFrame(oldTurn.snapshot, {
			sessionId: session.id,
			turnId: "turn-old",
			signal: new AbortController().signal,
		});
		const newFrame = await resolveModelCallFrame(newInstanceLease.snapshot, {
			sessionId: newSession.id,
			turnId: "turn-new-instance",
			signal: new AbortController().signal,
		});
		const rolledFrame = await resolveModelCallFrame(rolledTurn.snapshot, {
			sessionId: session.id,
			turnId: "turn-rolled",
			signal: new AbortController().signal,
		});
		expect(oldTurn.snapshot.instructions[0]?.content).toBe("v1");
		expect((oldTurn.modelBinding?.model as unknown as { id?: string }).id).toBe("v1");
		expect(rolledTurn.snapshot.instructions[0]?.content).toBe("v2");
		expect((rolledTurn.modelBinding?.model as unknown as { id?: string }).id).toBe("v2");
		expect(oldFrame.systemPromptStableLength).toBe("v1".length);
		expect(newFrame.systemPromptStableLength).toBe("v2".length);
		expect(rolledFrame.systemPromptStableLength).toBe("v2".length);
		expect(oldFrame.instructions[0]?.content).toBe("v1");
		expect(rolledFrame.instructions[0]?.content).toBe("v2");
		expect(session.revisionId).toBe("revision-2");
		await expect(session.rolloutToLatest()).resolves.toEqual({ status: "unchanged", revisionId: "revision-2" });

		await oldTurn.release();
		await rolledTurn.release();
		await stillOldLease.release();
		await newInstanceLease.release();
		await host.close();
		await registry.close();
		expect(lifecycle.indexOf("session:v2:dispose")).toBeLessThan(lifecycle.indexOf("definition:v2:dispose"));
	});

	it("rejects Session Extension topology changes during rollout and keeps the old generation", async () => {
		const lifecycle: string[] = [];
		const registry = registryWithIds();
		registry.upsert(candidate("code", "1", agentDefinition("agent", "v1", lifecycle, [extension("state-a")])));
		const host = new RuntimeAgentRuntime({ registry });
		const instance = await host.createInstance({ agentId: "agent", instanceId: "instance" });
		const session = await host.createSession(instance.id, { sessionId: "session" });
		registry.upsert(candidate("code", "2", agentDefinition("agent", "v2", lifecycle, [extension("state-b")])));

		await expect(session.rolloutToLatest()).rejects.toMatchObject({
			code: RUNTIME_AGENT_ERROR_CODES.ROLLOUT_EXTENSION_TOPOLOGY,
		});
		const lease = await session.acquire(turnContext(session.id, "turn-after-failure"));
		expect(lease.snapshot.instructions[0]?.content).toBe("v1");
		expect(session.revisionId).toBe("revision-1");
		await lease.release();
		await host.close();
		await registry.close();
	});

	it("rejects rollout plans that would replace activated product Session resources", async () => {
		const registry = registryWithIds();
		registry.upsert(candidate("code", "1", agentDefinition("agent", "v1", [])));
		const host = new RuntimeAgentRuntime({ registry });
		const instance = await host.createInstance({ agentId: "agent", instanceId: "instance" });
		const session = await host.createSession(instance.id, { sessionId: "session" });
		const activate = vi.fn(() => {
			throw new Error("must not activate");
		});
		const dispose = vi.fn(async () => {});
		registry.upsert(
			candidate("code", "2", {
				id: "agent",
				createInstance: () => ({
					prepareSession: () => ({
						definition: { capabilities: capabilities("v2") },
						activate,
						dispose,
					}),
				}),
			}),
		);

		await expect(session.rolloutToLatest()).rejects.toThrow("cannot replace activated product Session resources");
		expect(activate).not.toHaveBeenCalled();
		expect(dispose).toHaveBeenCalledOnce();
		expect(session.revisionId).toBe("revision-1");

		await host.close();
		await registry.close();
	});

	it("atomically rebinds a continued Session identity without changing its revision or active lease", async () => {
		const registry = registryWithIds();
		registry.upsert(candidate("code", "1", agentDefinition("agent", "v1", [])));
		const observations: RuntimeObservationRecord[] = [];
		const host = new RuntimeAgentRuntime({
			registry,
			observationPort: {
				record: (record) => {
					observations.push(record);
				},
			},
		});
		const instance = await host.createInstance({ agentId: "agent", instanceId: "instance" });
		const session = await host.createSession(instance.id, { sessionId: "session-old" });
		await host.createSession(instance.id, { sessionId: "session-conflict" });
		const activeLease = await session.acquire(turnContext(session.id, "turn-before-rebind"));

		expect(host.rebindSession("session-old", "session-new")).toBe(true);
		expect(session.id).toBe("session-new");
		expect(session.revisionId).toBe("revision-1");
		expect(host.getSession("session-old")).toBeUndefined();
		expect(host.requireSession("session-new")).toBe(session);
		expect(instance.snapshot().sessionIds).toEqual(["session-conflict", "session-new"]);
		expect(host.rebindSession("session-new", "session-new")).toBe(false);
		expect(() => host.rebindSession("session-new", "session-conflict")).toThrow("already registered");
		expect(session.id).toBe("session-new");
		expect(activeLease.snapshot.instructions[0]?.content).toBe("v1");
		expect(
			observations
				.filter(({ token }) => token === RUNTIME_AGENT_LIFECYCLE_OBSERVATION)
				.map(({ context, payload }) => ({ context, payload })),
		).toEqual(
			expect.arrayContaining([
				{
					context: {
						agentId: "agent",
						revisionId: "revision-1",
						instanceId: "instance",
						sessionId: "session-new",
					},
					payload: { operation: "session.rebind", phase: "completed" },
				},
				expect.objectContaining({
					context: expect.objectContaining({ sessionId: "session-new" }),
					payload: expect.objectContaining({
						operation: "session.rebind",
						phase: "failed",
						failure: expect.objectContaining({ category: "error", errorName: "RuntimeAgentError" }),
					}),
				}),
			]),
		);

		await activeLease.release();
		await host.close();
		await registry.close();
	});

	it("rolls back Session Definition and Extension resources when Feature compilation fails", async () => {
		const lifecycle: string[] = [];
		const registry = registryWithIds();
		registry.upsert(candidate("code", "1", failingAgentDefinition(lifecycle)));
		const host = new RuntimeAgentRuntime({ registry });
		const instance = await host.createInstance({ agentId: "broken", instanceId: "instance" });

		await expect(host.createSession(instance.id, { sessionId: "broken-session" })).rejects.toThrow(
			"feature prepare failed",
		);
		expect(host.getSession("broken-session")).toBeUndefined();
		expect(lifecycle).toEqual(["extension:create", "feature:prepare", "extension:dispose", "session:dispose"]);
		await host.close();
		await registry.close();
	});

	it("keeps Session Plan activation inside the Agent initialization transaction", async () => {
		const lifecycle: string[] = [];
		const registry = registryWithIds();
		registry.upsert(
			candidate("code", "1", {
				id: "activation-failure",
				createInstance: () => ({
					prepareSession: () => ({
						definition: { capabilities: capabilities("activation") },
						activate: async () => {
							lifecycle.push("plan:activate");
							throw new Error("activation failed");
						},
						onFailure: () => lifecycle.push("plan:failed"),
						dispose: () => {
							lifecycle.push("plan:dispose");
						},
					}),
				}),
			}),
		);
		const host = new RuntimeAgentRuntime({ registry });
		const instance = await host.createInstance({ agentId: "activation-failure", instanceId: "instance" });

		await expect(host.createSession(instance.id, { sessionId: "session" })).rejects.toThrow("activation failed");
		expect(host.getSession("session")).toBeUndefined();
		expect(lifecycle).toEqual(["plan:activate", "plan:failed", "plan:dispose"]);

		await host.close();
		await registry.close();
	});

	it("retains failed close ownership and retries only unfinished Agent resources", async () => {
		const registry = registryWithIds();
		const observations: RuntimeObservationRecord[] = [];
		const extensionDispose = vi.fn(async () => {});
		let planDisposeAttempts = 0;
		registry.upsert(
			candidate("code", "1", {
				id: "retryable-close",
				createInstance: () => ({
					prepareSession: () => ({
						definition: {
							capabilities: capabilities("retryable-close"),
							sessionExtensions: [
								{
									id: "state",
									create: async () => ({ contributions: [], dispose: extensionDispose }),
								},
							],
						},
						dispose: async () => {
							planDisposeAttempts += 1;
							if (planDisposeAttempts === 1) throw new Error("session plan cleanup failed");
						},
					}),
				}),
			}),
		);
		const host = new RuntimeAgentRuntime({
			registry,
			observationPort: {
				record: (record) => {
					observations.push(record);
				},
			},
		});
		const instance = await host.createInstance({ agentId: "retryable-close", instanceId: "instance" });
		await host.createSession(instance.id, { sessionId: "session" });

		const firstClose = host.close();
		const concurrentClose = host.close();
		expect(concurrentClose).toBe(firstClose);
		await expect(firstClose).rejects.toThrow("session plan cleanup failed");
		expect(host.getSession("session")).toBeDefined();
		expect(host.getInstance("instance")).toBeDefined();
		expect(extensionDispose).toHaveBeenCalledOnce();
		expect(planDisposeAttempts).toBe(1);

		await expect(host.close()).resolves.toBeUndefined();
		expect(host.getSession("session")).toBeUndefined();
		expect(host.getInstance("instance")).toBeUndefined();
		expect(extensionDispose).toHaveBeenCalledOnce();
		expect(planDisposeAttempts).toBe(2);
		expect(
			observations
				.filter(isAgentLifecycleObservation)
				.filter(({ payload }) => payload.operation === "session.close")
				.map(({ payload }) => payload.phase),
		).toEqual(["failed", "completed"]);

		await registry.close();
	});
});

function isAgentLifecycleObservation(
	record: RuntimeObservationRecord,
): record is RuntimeObservationRecord<RuntimeAgentLifecycleObservation> {
	return record.token === RUNTIME_AGENT_LIFECYCLE_OBSERVATION;
}

function registryWithIds(): RuntimeAgentRegistry {
	let nextId = 0;
	return new RuntimeAgentRegistry({ createRevisionId: () => `revision-${++nextId}` });
}

function candidate(sourceId: string, revision: string, definition: RuntimeAgentDefinition) {
	return { source: { id: sourceId, revision }, definition };
}

function agentDefinition(
	id: string,
	version: string,
	lifecycle: string[],
	sessionExtensions: readonly SessionExtensionDefinition[] = [],
): RuntimeAgentDefinition {
	return {
		id,
		createInstance: (context) => {
			lifecycle.push(`instance:${version}:create:${String(context.configuration !== undefined)}`);
			return {
				prepareSession: (sessionContext) => {
					lifecycle.push(`session:${version}:create:${String(sessionContext.configuration !== undefined)}`);
					return {
						capabilities: capabilities(version),
						modelBindingProvider: { bind: () => ({ model: { id: version } as never }) },
						sessionExtensions,
						dispose: () => {
							lifecycle.push(`session:${version}:dispose`);
						},
					};
				},
				dispose: () => {
					lifecycle.push(`instance:${version}:dispose`);
				},
			};
		},
		dispose: () => {
			lifecycle.push(`definition:${version}:dispose`);
		},
	};
}

function failingAgentDefinition(lifecycle: string[]): RuntimeAgentDefinition {
	const failingFeature: AgentFeatureDefinition = {
		id: "failing",
		prepare: async () => {
			lifecycle.push("feature:prepare");
			throw new Error("feature prepare failed");
		},
	};
	return {
		id: "broken",
		createInstance: () => ({
			prepareSession: () => ({
				capabilities: capabilities("broken", [failingFeature]),
				sessionExtensions: [
					{
						id: "extension",
						create: async () => {
							lifecycle.push("extension:create");
							return {
								contributions: [],
								dispose: async () => {
									lifecycle.push("extension:dispose");
								},
							};
						},
					},
				],
				dispose: () => {
					lifecycle.push("session:dispose");
				},
			}),
		}),
	};
}

function capabilities(version: string, features: readonly AgentFeatureDefinition[] = []): RuntimeCapabilityDefinition {
	return {
		instructions: [{ id: "base", content: version, priority: 0 }],
		features,
		contextStrategy: new PassthroughContextStrategy(),
		toolPolicy: { authorize: async () => true },
		tokenBudget: 8_000,
		reservedOutputTokens: 1_000,
	};
}

function extension(id: string): SessionExtensionDefinition {
	return {
		id,
		create: async () => ({ contributions: [], dispose: async () => {} }),
	};
}

function turnContext(sessionId: string, operationId: string) {
	return {
		sessionId,
		operationId,
		reason: "turn" as const,
		signal: new AbortController().signal,
	};
}
