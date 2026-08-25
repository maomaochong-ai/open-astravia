import { describe, expect, it } from "vitest";
import {
	RUNTIME_CONFIGURATION_ERROR_CODES,
	RUNTIME_CONFIGURATION_ISSUE_OBSERVATION,
	type RuntimeConfigurationDefinition,
	type RuntimeConfigurationJsonObject,
	RuntimeConfigurationRegistry,
} from "../../src/configuration/index.js";
import { createRuntimeObservationPublisher, type RuntimeObservationRecord } from "../../src/observation/index.js";

describe("RuntimeConfigurationRegistry", () => {
	it("publishes source-qualified definitions and keeps acquired revisions alive across replacement", async () => {
		const disposed: string[] = [];
		const registry = registryWithIds();
		registry.upsert(candidate("builtin", "1", definition("builtin.read", 1, 1280, disposed)));
		registry.upsert(candidate("plugin.media", "7", definition("plugin.media.render", 1, 720, disposed)));

		expect(registry.snapshot()).toMatchObject({
			version: 2,
			closed: false,
			revisionCount: 2,
			entries: [
				{
					configurationId: "builtin.read",
					sourceId: "builtin",
					state: "active",
					currentRevisionId: "configuration-revision-1",
				},
				{
					configurationId: "plugin.media.render",
					sourceId: "plugin.media",
					state: "active",
					currentRevisionId: "configuration-revision-2",
				},
			],
		});

		const oldLease = registry.acquire("builtin.read");
		registry.upsert(candidate("builtin", "2", definition("builtin.read", 2, 1920, disposed)));
		const currentLease = registry.acquire("builtin.read");

		expect(oldLease.revision.definition.schemaVersion).toBe(1);
		expect(currentLease.revision.definition.schemaVersion).toBe(2);
		expect(disposed).toEqual([]);

		await oldLease.release();
		expect(disposed).toEqual(["builtin.read@1"]);
		await currentLease.release();
		await registry.close();
		expect(disposed.sort()).toEqual(["builtin.read@1", "builtin.read@2", "plugin.media.render@1"]);
	});

	it("atomically replaces a complete source and rejects conflicts or invalid defaults", async () => {
		const records: RuntimeObservationRecord[] = [];
		const publisher = createRuntimeObservationPublisher({ port: { record: (record) => void records.push(record) } });
		const registry = registryWithIds(publisher);
		registry.replaceSource({ id: "workspace", revision: "1" }, [
			definition("alpha", 1, 100),
			definition("beta", 1, 200),
		]);
		registry.upsert(candidate("remote", "1", definition("gamma", 1, 300)));
		const before = registry.snapshot();

		expect(() =>
			registry.replaceSource({ id: "workspace", revision: "2" }, [
				definition("alpha", 2, 101),
				definition("gamma", 2, 301),
			]),
		).toThrow(expect.objectContaining({ code: RUNTIME_CONFIGURATION_ERROR_CODES.SOURCE_CONFLICT }));
		expect(registry.snapshot()).toEqual(before);

		expect(() =>
			registry.replaceSource({ id: "workspace", revision: "2" }, [
				definition("alpha", 2, 101),
				invalidDefaultDefinition("invalid-secret", "SECRET_MARKER"),
			]),
		).toThrow(expect.objectContaining({ code: RUNTIME_CONFIGURATION_ERROR_CODES.INVALID_DEFINITION }));
		expect(registry.snapshot()).toEqual(before);

		const changed = registry.replaceSource({ id: "workspace", revision: "3" }, [definition("alpha", 3, 102)]);
		expect(changed.removedConfigurationIds).toEqual(["beta"]);
		expect(records.some(({ token }) => token === RUNTIME_CONFIGURATION_ISSUE_OBSERVATION)).toBe(true);
		expect(JSON.stringify(records)).not.toContain("SECRET_MARKER");
		await registry.close();
	});

	it("distinguishes retire from remove and waits for snapshot leases before close", async () => {
		const registry = registryWithIds();
		registry.upsert(candidate("builtin", "1", definition("builtin.read", 1, 1280)));
		const lease = registry.acquireSnapshot();

		expect(registry.retire("builtin.read")).toBe(true);
		expect(registry.retire("builtin.read")).toBe(false);
		expect(() => registry.acquire("builtin.read")).toThrow(
			expect.objectContaining({ code: RUNTIME_CONFIGURATION_ERROR_CODES.UNAVAILABLE }),
		);
		expect(registry.remove("builtin.read")).toBe(true);
		expect(registry.snapshot().entries).toEqual([]);

		let closed = false;
		const closing = registry.close().finally(() => {
			closed = true;
		});
		await Promise.resolve();
		expect(closed).toBe(false);
		await lease.release();
		await lease.release();
		await closing;
		expect(closed).toBe(true);
	});
});

function registryWithIds(observationPublisher?: ReturnType<typeof createRuntimeObservationPublisher>) {
	let nextId = 0;
	return new RuntimeConfigurationRegistry({
		createRevisionId: () => `configuration-revision-${++nextId}`,
		now: () => 100,
		observationPublisher,
	});
}

function candidate(sourceId: string, sourceRevision: string, value: RuntimeConfigurationDefinition) {
	return { source: { id: sourceId, revision: sourceRevision }, definition: value };
}

function definition(
	id: string,
	schemaVersion: number,
	maxWidth: number,
	disposed: string[] = [],
): RuntimeConfigurationDefinition {
	return {
		id,
		schemaVersion,
		descriptor: {
			title: id,
			schema: { type: "object", properties: { maxWidth: { type: "number" } } },
		},
		codec: {
			decode: (value) => decodeMaxWidth(value),
		},
		defaultValue: { maxWidth },
		apply: "next-turn",
		dispose: () => {
			disposed.push(`${id}@${schemaVersion}`);
		},
	};
}

function invalidDefaultDefinition(id: string, value: string): RuntimeConfigurationDefinition {
	return {
		id,
		schemaVersion: 1,
		descriptor: { title: id, schema: { type: "object" }, sensitivePaths: ["/secret"] },
		codec: { decode: (input) => decodeMaxWidth(input) },
		defaultValue: { secret: value },
		apply: "next-turn",
	};
}

function decodeMaxWidth(value: unknown): RuntimeConfigurationJsonObject {
	if (!isRecord(value) || typeof value.maxWidth !== "number" || value.maxWidth <= 0) {
		throw new RangeError("invalid maxWidth");
	}
	return { ...value, maxWidth: value.maxWidth } as RuntimeConfigurationJsonObject;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
