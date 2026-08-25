import { describe, expect, it } from "vitest";
import {
	RUNTIME_AGENT_REGISTRY_ERROR_CODES,
	type RuntimeAgentDefinition,
	RuntimeAgentRegistry,
} from "../../src/agents/index.js";
import { PassthroughContextStrategy, type RuntimeCapabilityDefinition } from "../../src/kernel/index.js";
import { createRuntimeObservationPublisher } from "../../src/observation/index.js";

const observationPublisher = createRuntimeObservationPublisher();

describe("RuntimeAgentRegistry", () => {
	it("publishes and acquires multiple peer Agent definitions", async () => {
		const disposed: string[] = [];
		const registry = registryWithIds();
		registry.upsert(candidate("code", "1", definition("writer", "write", disposed)));
		registry.upsert(candidate("remote", "7", definition("reviewer", "review", disposed)));

		expect(registry.snapshot()).toMatchObject({
			closed: false,
			revisionCount: 2,
			retiredRevisionCount: 0,
			activeLeaseCount: 0,
			entries: [
				{ agentId: "reviewer", sourceId: "remote", state: "active", currentRevisionId: "revision-2" },
				{ agentId: "writer", sourceId: "code", state: "active", currentRevisionId: "revision-1" },
			],
		});

		const writer = registry.acquire("writer");
		const reviewer = registry.acquire("reviewer");
		const writerInstance = await writer.revision.definition.createInstance({
			agentId: "writer",
			revisionId: writer.revision.id,
			instanceId: "writer-1",
			signal: new AbortController().signal,
			observationPublisher,
		});
		const reviewerInstance = await reviewer.revision.definition.createInstance({
			agentId: "reviewer",
			revisionId: reviewer.revision.id,
			instanceId: "reviewer-1",
			signal: new AbortController().signal,
			observationPublisher,
		});

		const writerSession = await writerInstance.createSession({
			agentId: "writer",
			revisionId: writer.revision.id,
			instanceId: "writer-1",
			sessionId: "writer-session",
			signal: new AbortController().signal,
			observationPublisher,
		});
		const reviewerSession = await reviewerInstance.createSession({
			agentId: "reviewer",
			revisionId: reviewer.revision.id,
			instanceId: "reviewer-1",
			sessionId: "reviewer-session",
			signal: new AbortController().signal,
			observationPublisher,
		});

		expect(writerSession.capabilities.instructions[0]?.content).toBe("write");
		expect(reviewerSession.capabilities.instructions[0]?.content).toBe("review");
		await writer.release();
		await reviewer.release();
		await registry.close();
		expect(disposed.sort()).toEqual(["review", "write"]);
	});

	it("keeps an acquired revision alive across ordinary replacement", async () => {
		const disposed: string[] = [];
		const registry = registryWithIds();
		registry.upsert(candidate("code", "1", definition("agent", "v1", disposed)));
		const oldLease = registry.acquire("agent");

		registry.upsert(candidate("code", "2", definition("agent", "v2", disposed)));
		const newLease = registry.acquire("agent");
		expect(oldLease.revision.id).toBe("revision-1");
		expect(newLease.revision.id).toBe("revision-2");
		expect(disposed).toEqual([]);
		expect(
			(
				await (
					await oldLease.revision.definition.createInstance({
						agentId: "agent",
						revisionId: oldLease.revision.id,
						instanceId: "old",
						signal: new AbortController().signal,
						observationPublisher,
					})
				).createSession({
					agentId: "agent",
					revisionId: oldLease.revision.id,
					instanceId: "old",
					sessionId: "old-session",
					signal: new AbortController().signal,
					observationPublisher,
				})
			).capabilities.instructions[0]?.content,
		).toBe("v1");

		await oldLease.release();
		expect(disposed).toEqual(["v1"]);
		await newLease.release();
		await registry.close();
		expect(disposed).toEqual(["v1", "v2"]);
	});

	it("atomically replaces a complete source while rejecting cross-source conflicts", async () => {
		const disposed: string[] = [];
		const registry = registryWithIds();
		registry.replaceSource({ id: "workspace", revision: "1" }, [
			definition("alpha", "alpha-v1", disposed),
			definition("beta", "beta-v1", disposed),
		]);
		registry.upsert(candidate("remote", "1", definition("gamma", "gamma-v1", disposed)));
		const betaLease = registry.acquire("beta");
		const before = registry.snapshot();

		expect(() =>
			registry.replaceSource({ id: "workspace", revision: "2" }, [
				definition("alpha", "alpha-v2", disposed),
				definition("gamma", "conflict", disposed),
			]),
		).toThrow(expect.objectContaining({ code: RUNTIME_AGENT_REGISTRY_ERROR_CODES.SOURCE_CONFLICT }));
		expect(registry.snapshot()).toEqual(before);
		expect(() =>
			registry.replaceSource({ id: "workspace", revision: "2" }, [
				definition("alpha", "first", disposed),
				definition("alpha", "duplicate", disposed),
			]),
		).toThrow(expect.objectContaining({ code: RUNTIME_AGENT_REGISTRY_ERROR_CODES.INVALID_DEFINITION }));
		expect(registry.snapshot()).toEqual(before);

		const changed = registry.replaceSource({ id: "workspace", revision: "2" }, [
			definition("alpha", "alpha-v2", disposed),
		]);
		expect(changed.removedAgentIds).toEqual(["beta"]);
		expect(() => registry.acquire("beta")).toThrow(
			expect.objectContaining({ code: RUNTIME_AGENT_REGISTRY_ERROR_CODES.NOT_FOUND }),
		);
		expect(betaLease.revision.definition.id).toBe("beta");
		await betaLease.release();
		expect(disposed).toContain("beta-v1");
		await registry.close();
	});

	it("distinguishes retirement from removal and makes release idempotent", async () => {
		const disposed: string[] = [];
		const registry = registryWithIds();
		registry.upsert(candidate("code", "1", definition("agent", "v1", disposed)));
		const lease = registry.acquire("agent");

		expect(registry.retire("agent")).toBe(true);
		expect(registry.retire("agent")).toBe(false);
		expect(registry.snapshot().entries).toMatchObject([{ agentId: "agent", state: "retired" }]);
		expect(() => registry.acquire("agent")).toThrow(
			expect.objectContaining({ code: RUNTIME_AGENT_REGISTRY_ERROR_CODES.UNAVAILABLE }),
		);
		expect(registry.remove("agent")).toBe(true);
		expect(registry.snapshot().entries).toEqual([]);
		await lease.release();
		await lease.release();
		expect(disposed).toEqual(["v1"]);
		await registry.close();
	});

	it("waits for leases on close and aggregates revision disposal failures", async () => {
		const registry = registryWithIds();
		registry.upsert(candidate("code", "1", definition("agent", "v1", [], new Error("dispose failed"))));
		const lease = registry.acquire("agent");
		let closed = false;
		const closing = registry.close().finally(() => {
			closed = true;
		});
		await Promise.resolve();
		expect(closed).toBe(false);
		expect(() => registry.acquire("agent")).toThrow(
			expect.objectContaining({ code: RUNTIME_AGENT_REGISTRY_ERROR_CODES.CLOSED }),
		);

		await expect(lease.release()).rejects.toThrow("dispose failed");
		await expect(closing).rejects.toThrow("Failed to dispose one or more Runtime Agent revisions");
		expect(closed).toBe(true);
	});
});

function registryWithIds(): RuntimeAgentRegistry {
	let nextId = 0;
	return new RuntimeAgentRegistry({
		createRevisionId: () => `revision-${++nextId}`,
		now: () => 100,
	});
}

function candidate(sourceId: string, sourceRevision: string, value: RuntimeAgentDefinition) {
	return {
		source: { id: sourceId, revision: sourceRevision },
		definition: value,
	};
}

function definition(id: string, instruction: string, disposed: string[], disposeError?: Error): RuntimeAgentDefinition {
	return {
		id,
		createInstance: () => ({ createSession: () => ({ capabilities: capabilities(instruction) }) }),
		dispose: async () => {
			disposed.push(instruction);
			if (disposeError) throw disposeError;
		},
	};
}

function capabilities(instruction: string): RuntimeCapabilityDefinition {
	return {
		instructions: [{ id: "base", content: instruction, priority: 0 }],
		features: [],
		contextStrategy: new PassthroughContextStrategy(),
		toolPolicy: { authorize: async () => true },
		tokenBudget: 8_000,
		reservedOutputTokens: 1_000,
	};
}
