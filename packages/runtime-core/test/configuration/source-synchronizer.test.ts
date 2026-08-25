import { describe, expect, it } from "vitest";
import {
	type RuntimeConfigurationDefinition,
	type RuntimeConfigurationDefinitionSource,
	type RuntimeConfigurationDefinitionSourceSnapshot,
	RuntimeConfigurationDefinitionSynchronizer,
	type RuntimeConfigurationJsonObject,
	RuntimeConfigurationRegistry,
} from "../../src/configuration/index.js";

describe("RuntimeConfigurationDefinitionSynchronizer", () => {
	it("keeps last-known-good after a failed refresh and atomically replaces the source on recovery", async () => {
		const source = new QueuedSource("workspace");
		const registry = registryWithIds();
		const synchronizer = new RuntimeConfigurationDefinitionSynchronizer({ source, registry, now: () => 200 });
		source.enqueue(snapshot("1", [definition("alpha", 1)]));

		await expect(synchronizer.refresh()).resolves.toMatchObject({ status: "applied", sourceRevision: "1" });
		source.enqueue(new Error("source unavailable with SECRET_MARKER"));
		await expect(synchronizer.refresh()).rejects.toThrow("source unavailable");
		expect(synchronizer.snapshot()).toEqual({
			sourceId: "workspace",
			phase: "failed",
			desiredRevision: "1",
			publishedRevision: "1",
			failure: { occurredAt: 200, errorName: "Error" },
		});
		const retained = registry.acquire("alpha");
		expect(retained.revision.id).toBe("configuration-revision-1");
		await retained.release();

		source.enqueue(snapshot("2", [definition("beta", 2)]));
		await expect(synchronizer.refresh()).resolves.toMatchObject({
			status: "applied",
			sourceRevision: "2",
			removedConfigurationIds: ["alpha"],
		});
		expect(registry.snapshot().entries.map(({ configurationId }) => configurationId)).toEqual(["beta"]);
		source.enqueue(snapshot("2", [definition("ignored", 3)]));
		await expect(synchronizer.refresh()).resolves.toEqual({ status: "unchanged", sourceRevision: "2" });
		expect(registry.snapshot().entries.map(({ configurationId }) => configurationId)).toEqual(["beta"]);
		synchronizer.close();
		await registry.close();
	});

	it("publishes only the newest concurrent source load", async () => {
		const source = new DeferredSource("remote");
		const registry = registryWithIds();
		const synchronizer = new RuntimeConfigurationDefinitionSynchronizer({ source, registry });
		const first = synchronizer.refresh();
		const second = synchronizer.refresh();

		source.resolve(1, snapshot("2", [definition("new", 2)]));
		await expect(second).resolves.toMatchObject({ status: "applied", sourceRevision: "2" });
		source.resolve(0, snapshot("1", [definition("old", 1)]));
		await expect(first).resolves.toEqual({ status: "superseded" });
		expect(registry.snapshot().entries.map(({ configurationId }) => configurationId)).toEqual(["new"]);
		synchronizer.close();
		await registry.close();
	});
});

class QueuedSource implements RuntimeConfigurationDefinitionSource {
	readonly queue: Array<RuntimeConfigurationDefinitionSourceSnapshot | Error> = [];

	constructor(readonly id: string) {}

	enqueue(value: RuntimeConfigurationDefinitionSourceSnapshot | Error): void {
		this.queue.push(value);
	}

	async load(signal: AbortSignal): Promise<RuntimeConfigurationDefinitionSourceSnapshot> {
		signal.throwIfAborted();
		const value = this.queue.shift();
		if (!value) throw new Error("No queued source snapshot");
		if (value instanceof Error) throw value;
		return value;
	}
}

class DeferredSource implements RuntimeConfigurationDefinitionSource {
	readonly requests: Array<{
		readonly resolve: (snapshot: RuntimeConfigurationDefinitionSourceSnapshot) => void;
	}> = [];

	constructor(readonly id: string) {}

	load(signal: AbortSignal): Promise<RuntimeConfigurationDefinitionSourceSnapshot> {
		return new Promise((resolve, reject) => {
			const onAbort = () => reject(signal.reason);
			signal.addEventListener("abort", onAbort, { once: true });
			this.requests.push({
				resolve: (value) => {
					signal.removeEventListener("abort", onAbort);
					resolve(value);
				},
			});
		});
	}

	resolve(index: number, value: RuntimeConfigurationDefinitionSourceSnapshot): void {
		this.requests[index]?.resolve(value);
	}
}

function registryWithIds(): RuntimeConfigurationRegistry {
	let nextId = 0;
	return new RuntimeConfigurationRegistry({ createRevisionId: () => `configuration-revision-${++nextId}` });
}

function snapshot(
	revision: string,
	definitions: readonly RuntimeConfigurationDefinition[],
): RuntimeConfigurationDefinitionSourceSnapshot {
	return { revision, definitions };
}

function definition(id: string, value: number): RuntimeConfigurationDefinition {
	return {
		id,
		schemaVersion: 1,
		descriptor: { title: id, schema: { type: "object" } },
		codec: {
			decode: (input) => {
				if (!isRecord(input) || typeof input.value !== "number") throw new TypeError("invalid value");
				return { value: input.value } satisfies RuntimeConfigurationJsonObject;
			},
		},
		defaultValue: { value },
		apply: "next-turn",
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
