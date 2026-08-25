import { describe, expect, it } from "vitest";
import {
	RUNTIME_AGENT_HOST_ERROR_CODES,
	type RuntimeAgentDefinition,
	RuntimeAgentHost,
	RuntimeAgentRegistry,
} from "../../src/agents/index.js";
import {
	type AgentFeatureDefinition,
	PassthroughContextStrategy,
	type RuntimeCapabilityDefinition,
	resolveModelCallFrame,
} from "../../src/kernel/index.js";
import type { SessionExtensionDefinition } from "../../src/session-extensions/index.js";

describe("RuntimeAgentHost", () => {
	it("routes multiple peer Agents, Instances and isolated Sessions", async () => {
		const lifecycle: string[] = [];
		const registry = registryWithIds();
		registry.upsert(candidate("code", "1", agentDefinition("writer", "write-v1", lifecycle)));
		registry.upsert(candidate("code", "1", agentDefinition("reviewer", "review-v1", lifecycle)));
		const host = new RuntimeAgentHost({ registry });
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
		const host = new RuntimeAgentHost({ registry });
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
		const host = new RuntimeAgentHost({ registry });
		const instance = await host.createInstance({ agentId: "agent", instanceId: "instance" });
		const session = await host.createSession(instance.id, { sessionId: "session" });
		registry.upsert(candidate("code", "2", agentDefinition("agent", "v2", lifecycle, [extension("state-b")])));

		await expect(session.rolloutToLatest()).rejects.toMatchObject({
			code: RUNTIME_AGENT_HOST_ERROR_CODES.ROLLOUT_EXTENSION_TOPOLOGY,
		});
		const lease = await session.acquire(turnContext(session.id, "turn-after-failure"));
		expect(lease.snapshot.instructions[0]?.content).toBe("v1");
		expect(session.revisionId).toBe("revision-1");
		await lease.release();
		await host.close();
		await registry.close();
	});

	it("rolls back Session Definition and Extension resources when Feature compilation fails", async () => {
		const lifecycle: string[] = [];
		const registry = registryWithIds();
		registry.upsert(candidate("code", "1", failingAgentDefinition(lifecycle)));
		const host = new RuntimeAgentHost({ registry });
		const instance = await host.createInstance({ agentId: "broken", instanceId: "instance" });

		await expect(host.createSession(instance.id, { sessionId: "broken-session" })).rejects.toThrow(
			"feature prepare failed",
		);
		expect(host.getSession("broken-session")).toBeUndefined();
		expect(lifecycle).toEqual(["extension:create", "feature:prepare", "extension:dispose", "session:dispose"]);
		await host.close();
		await registry.close();
	});
});

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
				createSession: (sessionContext) => {
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
			createSession: () => ({
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
