import { describe, expect, it } from "vitest";
import {
	type RuntimeAgentDefinition,
	type RuntimeAgentDefinitionSource,
	type RuntimeAgentDefinitionSourceSnapshot,
	RuntimeAgentDefinitionSynchronizer,
	RuntimeAgentRegistry,
} from "../../src/agents/index.js";
import { PassthroughContextStrategy } from "../../src/kernel/index.js";

describe("RuntimeAgentDefinitionSynchronizer", () => {
	it("keeps last-known-good after a failed refresh and replaces the complete source on recovery", async () => {
		const source = new QueuedSource("workspace");
		const registry = registryWithIds();
		const synchronizer = new RuntimeAgentDefinitionSynchronizer({ source, registry, now: () => 200 });
		source.enqueue(snapshot("1", [definition("alpha", "v1")]));

		await expect(synchronizer.refresh()).resolves.toMatchObject({ status: "applied", sourceRevision: "1" });
		const alphaRevision = registry.acquire("alpha");
		await alphaRevision.release();
		source.enqueue(new Error("source unavailable"));
		await expect(synchronizer.refresh()).rejects.toThrow("source unavailable");
		expect(synchronizer.snapshot()).toEqual({
			sourceId: "workspace",
			phase: "failed",
			desiredRevision: "1",
			publishedRevision: "1",
			failure: { occurredAt: 200, errorName: "Error" },
		});
		const retainedAlpha = registry.acquire("alpha");
		expect(retainedAlpha.revision.id).toBe("revision-1");
		await retainedAlpha.release();

		source.enqueue(snapshot("2", [definition("beta", "v2")]));
		await expect(synchronizer.refresh()).resolves.toMatchObject({
			status: "applied",
			sourceRevision: "2",
			removedAgentIds: ["alpha"],
		});
		expect(registry.snapshot().entries.map(({ agentId }) => agentId)).toEqual(["beta"]);
		source.enqueue(snapshot("2", [definition("ignored", "same-revision")]));
		await expect(synchronizer.refresh()).resolves.toEqual({ status: "unchanged", sourceRevision: "2" });
		expect(registry.snapshot().entries.map(({ agentId }) => agentId)).toEqual(["beta"]);
		synchronizer.close();
		await registry.close();
	});

	it("publishes only the newest concurrent source load", async () => {
		const source = new DeferredSource("remote");
		const registry = registryWithIds();
		const synchronizer = new RuntimeAgentDefinitionSynchronizer({ source, registry });
		const first = synchronizer.refresh();
		const second = synchronizer.refresh();

		source.resolve(1, snapshot("2", [definition("new", "v2")]));
		await expect(second).resolves.toMatchObject({ status: "applied", sourceRevision: "2" });
		source.resolve(0, snapshot("1", [definition("old", "v1")]));
		await expect(first).resolves.toEqual({ status: "superseded" });
		expect(registry.snapshot().entries.map(({ agentId }) => agentId)).toEqual(["new"]);
		expect(synchronizer.snapshot()).toMatchObject({ phase: "published", publishedRevision: "2" });
		synchronizer.close();
		await registry.close();
	});

	it("subscribes once, aborts pending loads and unsubscribes on close", async () => {
		const source = new DeferredSource("plugin");
		let subscribed = 0;
		let unsubscribed = 0;
		source.subscribe = () => {
			subscribed += 1;
			return () => {
				unsubscribed += 1;
			};
		};
		const registry = registryWithIds();
		const synchronizer = new RuntimeAgentDefinitionSynchronizer({ source, registry });
		const starting = synchronizer.start();
		expect(subscribed).toBe(1);
		synchronizer.close();

		await expect(starting).rejects.toMatchObject({ name: "AbortError" });
		expect(unsubscribed).toBe(1);
		expect(synchronizer.snapshot().phase).toBe("closed");
		await registry.close();
	});
});

class QueuedSource implements RuntimeAgentDefinitionSource {
	readonly queue: Array<RuntimeAgentDefinitionSourceSnapshot | Error> = [];

	constructor(readonly id: string) {}

	enqueue(value: RuntimeAgentDefinitionSourceSnapshot | Error): void {
		this.queue.push(value);
	}

	async load(signal: AbortSignal): Promise<RuntimeAgentDefinitionSourceSnapshot> {
		signal.throwIfAborted();
		const value = this.queue.shift();
		if (!value) throw new Error("No queued source snapshot");
		if (value instanceof Error) throw value;
		return value;
	}
}

class DeferredSource implements RuntimeAgentDefinitionSource {
	readonly requests: Array<{
		readonly signal: AbortSignal;
		readonly resolve: (snapshot: RuntimeAgentDefinitionSourceSnapshot) => void;
		readonly reject: (error: unknown) => void;
	}> = [];
	subscribe?: (listener: () => void) => () => void;

	constructor(readonly id: string) {}

	load(signal: AbortSignal): Promise<RuntimeAgentDefinitionSourceSnapshot> {
		return new Promise((resolve, reject) => {
			const onAbort = () => reject(signal.reason);
			signal.addEventListener("abort", onAbort, { once: true });
			this.requests.push({
				signal,
				resolve: (snapshot) => {
					signal.removeEventListener("abort", onAbort);
					resolve(snapshot);
				},
				reject,
			});
		});
	}

	resolve(index: number, value: RuntimeAgentDefinitionSourceSnapshot): void {
		this.requests[index]?.resolve(value);
	}
}

function registryWithIds(): RuntimeAgentRegistry {
	let nextId = 0;
	return new RuntimeAgentRegistry({ createRevisionId: () => `revision-${++nextId}` });
}

function snapshot(
	revision: string,
	definitions: readonly RuntimeAgentDefinition[],
): RuntimeAgentDefinitionSourceSnapshot {
	return { revision, definitions };
}

function definition(id: string, instruction: string): RuntimeAgentDefinition {
	return {
		id,
		createInstance: () => ({
			createSession: () => ({
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
