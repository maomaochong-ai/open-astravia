import { describe, expect, it } from "vitest";
import {
	projectRuntimeConfigurationCatalog,
	RUNTIME_CONFIGURATION_ERROR_CODES,
	RUNTIME_CONFIGURATION_ISSUE_OBSERVATION,
	RuntimeConfigurationCenter,
	type RuntimeConfigurationDefinition,
	type RuntimeConfigurationJsonObject,
	RuntimeConfigurationLayerRegistry,
	RuntimeConfigurationSnapshotCoordinator,
} from "../../src/configuration/index.js";
import { createRuntimeObservationPublisher, type RuntimeObservationRecord } from "../../src/observation/index.js";

describe("RuntimeConfigurationLayerRegistry", () => {
	it("atomically aggregates source-owned layers in precedence order", () => {
		const registry = new RuntimeConfigurationLayerRegistry();
		registry.replaceSource({ id: "defaults-host", revision: "1" }, [
			layer("user", "1", 100, { "tool.output": { prefix: "user" } }),
		]);
		registry.replaceSource({ id: "workspace-host", revision: "7" }, [
			layer("workspace", "7", 200, { "tool.output": { prefix: "workspace" } }),
		]);

		expect(registry.snapshot()).toMatchObject({
			version: 2,
			closed: false,
			sources: [
				{ sourceId: "defaults-host", sourceRevision: "1", layerIds: ["user"] },
				{ sourceId: "workspace-host", sourceRevision: "7", layerIds: ["workspace"] },
			],
			layers: [{ id: "user" }, { id: "workspace" }],
		});
		expect(Object.isFrozen(registry.snapshot().layers[0]?.values["tool.output"])).toBe(true);
	});

	it("rejects ownership and precedence conflicts while retaining last-known-good", () => {
		const records: RuntimeObservationRecord[] = [];
		const publisher = createRuntimeObservationPublisher({ port: { record: (record) => void records.push(record) } });
		const registry = new RuntimeConfigurationLayerRegistry({ observationPublisher: publisher });
		registry.replaceSource({ id: "host-a", revision: "1" }, [
			layer("user", "1", 100, { "tool.output": { marker: "SAFE" } }),
		]);
		const before = registry.snapshot();

		expect(() =>
			registry.replaceSource({ id: "host-b", revision: "1" }, [
				layer("user", "2", 200, { "tool.output": { marker: "SECRET_MARKER" } }),
			]),
		).toThrow(expect.objectContaining({ code: RUNTIME_CONFIGURATION_ERROR_CODES.LAYER_SOURCE_CONFLICT }));
		expect(() =>
			registry.replaceSource({ id: "host-b", revision: "2" }, [
				layer("workspace", "2", 100, { "tool.output": { marker: "SECRET_MARKER" } }),
			]),
		).toThrow(expect.objectContaining({ code: RUNTIME_CONFIGURATION_ERROR_CODES.INVALID_LAYER }));

		expect(registry.snapshot()).toBe(before);
		expect(records.filter(({ token }) => token === RUNTIME_CONFIGURATION_ISSUE_OBSERVATION)).toHaveLength(2);
		expect(JSON.stringify(records)).not.toContain("SECRET_MARKER");
	});

	it("deduplicates a source revision and reports removed layers on replacement", () => {
		const registry = new RuntimeConfigurationLayerRegistry();
		const initial = registry.replaceSource({ id: "host", revision: "1" }, [
			layer("user", "1", 100, {}),
			layer("session", "1", 300, {}),
		]);
		const unchanged = registry.replaceSource({ id: "host", revision: "1" }, [layer("ignored", "1", 500, {})]);
		const changed = registry.replaceSource({ id: "host", revision: "2" }, [layer("user", "2", 100, {})]);

		expect(initial.status).toBe("published");
		expect(unchanged).toEqual({ status: "unchanged", sourceRevision: "1" });
		expect(changed).toMatchObject({ status: "published", removedLayerIds: ["session"] });
		expect(registry.snapshot().layers.map(({ id }) => id)).toEqual(["user"]);
	});
});

describe("RuntimeConfigurationCenter", () => {
	it("projects a serializable catalog without sensitive values", async () => {
		const center = new RuntimeConfigurationCenter();
		center.definitions.upsert({
			source: { id: "test", revision: "1" },
			definition: {
				id: "tool.output",
				schemaVersion: 1,
				descriptor: {
					title: "Tool output",
					schema: { type: "object" },
					sensitivePaths: ["/secret", "/nested/token"],
				},
				defaultValue: { prefix: "default", secret: "default-secret", nested: { token: "default-token" } },
				codec: {
					decode(value) {
						if (!isRecord(value) || typeof value.prefix !== "string") throw new TypeError("invalid");
						return value as RuntimeConfigurationJsonObject;
					},
				},
				apply: "next-turn",
			},
		});
		center.layers.replaceSource({ id: "settings", revision: "1" }, [
			layer("settings.user", "1", 100, {
				"tool.output": { secret: "current-secret", nested: { token: "current-token" } },
			}),
		]);
		const lease = center.acquire();
		const catalog = projectRuntimeConfigurationCatalog(lease.snapshot);

		expect(catalog.entries[0]).toMatchObject({
			configurationId: "tool.output",
			definitionSourceId: "test",
			value: { prefix: "default", nested: {} },
			defaultValue: { prefix: "default", nested: {} },
			redactedPaths: ["/secret", "/nested/token"],
		});
		expect(JSON.stringify(catalog.entries[0]?.value)).not.toContain("current-secret");
		expect(JSON.stringify(catalog.entries[0]?.defaultValue)).not.toContain("default-token");
		await lease.release();
		await center.close();
	});

	it("shares one captured generation across consumers of the same logical binding", async () => {
		let captures = 0;
		let releases = 0;
		const center = new RuntimeConfigurationCenter();
		center.definitions.upsert({
			source: { id: "builtin", revision: "1" },
			definition: definition("default"),
		});
		const coordinator = new RuntimeConfigurationSnapshotCoordinator({
			acquire: () => {
				captures += 1;
				const lease = center.acquire();
				return {
					snapshot: lease.snapshot,
					release: async () => {
						releases += 1;
						await lease.release();
					},
				};
			},
		});
		const signal = new AbortController().signal;
		const first = coordinator.acquire({ bindingId: "session-1/turn-1", signal });
		const second = coordinator.acquire({ bindingId: "session-1/turn-1", signal });
		const nextTurn = coordinator.acquire({ bindingId: "session-1/turn-2", signal });

		expect(first.snapshot).toBe(second.snapshot);
		expect(first.snapshot).not.toBe(nextTurn.snapshot);
		expect(captures).toBe(2);
		await first.release();
		expect(releases).toBe(0);
		await second.release();
		expect(releases).toBe(1);
		await nextTurn.release();
		expect(releases).toBe(2);
		await center.close();
	});

	it("gives new captures dynamic layers while old captures retain their generation", async () => {
		let nextRevision = 0;
		const center = new RuntimeConfigurationCenter({
			definitionRegistryOptions: { createRevisionId: () => `definition-${++nextRevision}` },
		});
		center.definitions.upsert({
			source: { id: "builtin", revision: "1" },
			definition: definition("default"),
		});
		center.layers.replaceSource({ id: "desktop", revision: "1" }, [
			layer("user", "1", 100, { "tool.output": { prefix: "old" } }),
		]);
		const oldLease = center.acquire();

		center.layers.replaceSource({ id: "desktop", revision: "2" }, [
			layer("user", "2", 100, { "tool.output": { prefix: "new" } }),
		]);
		const newLease = center.acquire();

		expect(oldLease.snapshot.get("tool.output")).toEqual({ prefix: "old" });
		expect(newLease.snapshot.get("tool.output")).toEqual({ prefix: "new" });
		expect(oldLease.snapshot.id).not.toBe(newLease.snapshot.id);

		let closed = false;
		const closing = center.close().finally(() => {
			closed = true;
		});
		await Promise.resolve();
		expect(closed).toBe(false);
		await oldLease.release();
		await newLease.release();
		await closing;
		expect(center.snapshot().layers.closed).toBe(true);
		expect(() => center.acquire()).toThrow(
			expect.objectContaining({ code: RUNTIME_CONFIGURATION_ERROR_CODES.CLOSED }),
		);
	});
});

function definition(prefix: string): RuntimeConfigurationDefinition {
	return {
		id: "tool.output",
		schemaVersion: 1,
		descriptor: { title: "Tool output", schema: { type: "object" } },
		codec: {
			decode(value) {
				if (!isRecord(value) || typeof value.prefix !== "string") throw new TypeError("invalid prefix");
				return { prefix: value.prefix };
			},
		},
		defaultValue: { prefix },
		apply: "next-turn",
	};
}

function layer(
	id: string,
	revision: string,
	precedence: number,
	values: Record<string, RuntimeConfigurationJsonObject>,
) {
	return { id, revision, precedence, values };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
