import { describe, expect, it } from "vitest";
import {
	RUNTIME_CONFIGURATION_ERROR_CODES,
	RUNTIME_CONFIGURATION_ISSUE_OBSERVATION,
	type RuntimeConfigurationDefinition,
	type RuntimeConfigurationJsonObject,
	type RuntimeConfigurationLayerSnapshot,
	RuntimeConfigurationRegistry,
	RuntimeConfigurationResolver,
} from "../../src/configuration/index.js";
import { createRuntimeObservationPublisher, type RuntimeObservationRecord } from "../../src/observation/index.js";

describe("RuntimeConfigurationResolver", () => {
	it("deep-merges ordered Host layers and replaces arrays while preserving immutable values", async () => {
		const registry = registryWithDefinition(imageDefinition(1, 1280));
		const resolver = new RuntimeConfigurationResolver(registry);
		const lease = resolver.capture([
			layer("user", "1", 100, {
				"image.model-input": { image: { quality: 80 } },
			}),
			layer("workspace", "2", 200, {
				"image.model-input": { image: { maxWidth: 1920 }, formats: ["jpeg"] },
			}),
		]);

		expect(lease.snapshot.get("image.model-input")).toEqual({
			enabled: true,
			image: { maxWidth: 1920, quality: 80 },
			formats: ["jpeg"],
		});
		expect(lease.snapshot.entries[0]?.appliedLayerIds).toEqual(["user", "workspace"]);
		expect(Object.isFrozen(lease.snapshot.get("image.model-input"))).toBe(true);
		expect(Object.isFrozen(lease.snapshot.get("image.model-input")?.image)).toBe(true);
		await lease.release();
		await registry.close();
	});

	it("skips an invalid value for one definition, continues higher layers, and emits value-free diagnostics", async () => {
		const records: RuntimeObservationRecord[] = [];
		const publisher = createRuntimeObservationPublisher({ port: { record: (record) => void records.push(record) } });
		const registry = registryWithDefinition(imageDefinition(1, 1280), publisher);
		const resolver = new RuntimeConfigurationResolver(registry, { observationPublisher: publisher });
		const lease = resolver.capture([
			layer("broken", "1", 100, {
				"image.model-input": { image: { maxWidth: -1 }, marker: "SECRET_MARKER" },
				"uninstalled.tool": { enabled: true },
			}),
			layer("session", "2", 200, {
				"image.model-input": { image: { quality: 60 } },
			}),
		]);

		expect(lease.snapshot.get("image.model-input")).toEqual({
			enabled: true,
			image: { maxWidth: 1280, quality: 60 },
			formats: ["png", "jpeg"],
		});
		expect(lease.snapshot.diagnostics).toEqual([
			{ code: "unknown-definition", configurationId: "uninstalled.tool", layerId: "broken" },
			{
				code: "invalid-layer-value",
				configurationId: "image.model-input",
				layerId: "broken",
				errorName: "RangeError",
			},
		]);
		expect(records.filter(({ token }) => token === RUNTIME_CONFIGURATION_ISSUE_OBSERVATION)).toHaveLength(2);
		expect(JSON.stringify(records)).not.toContain("SECRET_MARKER");
		await lease.release();
		await registry.close();
	});

	it("holds the captured Definition revision until release while new captures see replacements", async () => {
		const disposed: string[] = [];
		const registry = registryWithDefinition(imageDefinition(1, 1280, disposed));
		const resolver = new RuntimeConfigurationResolver(registry);
		const oldLease = resolver.capture([]);

		registry.upsert({
			source: { id: "builtin", revision: "2" },
			definition: imageDefinition(2, 1920, disposed),
		});
		const newLease = resolver.capture([]);

		expect(oldLease.snapshot.entries[0]).toMatchObject({ schemaVersion: 1, value: { image: { maxWidth: 1280 } } });
		expect(newLease.snapshot.entries[0]).toMatchObject({ schemaVersion: 2, value: { image: { maxWidth: 1920 } } });
		expect(disposed).toEqual([]);
		await oldLease.release();
		expect(disposed).toEqual(["image.model-input@1"]);
		await newLease.release();
		await registry.close();
		expect(disposed).toEqual(["image.model-input@1", "image.model-input@2"]);
	});

	it("rejects structurally ambiguous layers and releases the captured Definition set", async () => {
		const registry = registryWithDefinition(imageDefinition(1, 1280));
		const resolver = new RuntimeConfigurationResolver(registry);

		expect(() => resolver.capture([layer("user", "1", 100, {}), layer("workspace", "1", 100, {})])).toThrow(
			expect.objectContaining({ code: RUNTIME_CONFIGURATION_ERROR_CODES.INVALID_LAYER }),
		);
		await Promise.resolve();
		expect(registry.snapshot().activeLeaseCount).toBe(0);
		await registry.close();
	});

	it("only returns typed values when the requested Definition schema version matches", async () => {
		const current = imageDefinition(2, 1920);
		const registry = registryWithDefinition(current);
		const lease = new RuntimeConfigurationResolver(registry).capture([]);

		expect(lease.snapshot.read(current)).toMatchObject({ image: { maxWidth: 1920 } });
		expect(lease.snapshot.read(imageDefinition(1, 1280))).toBeUndefined();
		await lease.release();
		await registry.close();
	});
});

function registryWithDefinition(
	definition: RuntimeConfigurationDefinition,
	observationPublisher?: ReturnType<typeof createRuntimeObservationPublisher>,
): RuntimeConfigurationRegistry {
	let nextId = 0;
	const registry = new RuntimeConfigurationRegistry({
		createRevisionId: () => `configuration-revision-${++nextId}`,
		now: () => 100,
		observationPublisher,
	});
	registry.upsert({ source: { id: "builtin", revision: "1" }, definition });
	return registry;
}

function imageDefinition(
	schemaVersion: number,
	maxWidth: number,
	disposed: string[] = [],
): RuntimeConfigurationDefinition {
	return {
		id: "image.model-input",
		schemaVersion,
		descriptor: {
			title: "Model input images",
			schema: { type: "object" },
			sensitivePaths: ["/apiKey"],
		},
		codec: { decode: decodeImageConfiguration },
		defaultValue: {
			enabled: true,
			image: { maxWidth, quality: 70 },
			formats: ["png", "jpeg"],
		},
		apply: "next-turn",
		dispose: () => void disposed.push(`image.model-input@${schemaVersion}`),
	};
}

function decodeImageConfiguration(value: unknown): RuntimeConfigurationJsonObject {
	if (!isRecord(value) || typeof value.enabled !== "boolean") throw new TypeError("invalid enabled");
	if (!isRecord(value.image)) throw new TypeError("invalid image options");
	if (typeof value.image.maxWidth !== "number" || value.image.maxWidth <= 0) {
		throw new RangeError("invalid maxWidth");
	}
	if (typeof value.image.quality !== "number" || value.image.quality < 1 || value.image.quality > 100) {
		throw new RangeError("invalid quality");
	}
	if (!Array.isArray(value.formats) || value.formats.some((format) => typeof format !== "string")) {
		throw new TypeError("invalid formats");
	}
	return structuredClone(value) as RuntimeConfigurationJsonObject;
}

function layer(
	id: string,
	revision: string,
	precedence: number,
	values: Record<string, RuntimeConfigurationJsonObject>,
): RuntimeConfigurationLayerSnapshot {
	return { id, revision, precedence, values };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
