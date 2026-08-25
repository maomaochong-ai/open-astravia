import { type RuntimeObservationPublisher, runtimeObservationFailure } from "../observation/index.js";
import type {
	RuntimeConfigurationLayerRegistrySnapshot,
	RuntimeConfigurationLayerSnapshot,
	RuntimeConfigurationLayerSourcePublishResult,
	RuntimeConfigurationSourceRef,
} from "./contracts.js";
import {
	invalidRuntimeConfigurationLayerError,
	RUNTIME_CONFIGURATION_ERROR_CODES,
	RuntimeConfigurationError,
	runtimeConfigurationLayerSourceConflictError,
	runtimeConfigurationRegistryClosedError,
} from "./errors.js";
import { normalizeRuntimeConfigurationLayers } from "./layer-normalization.js";
import {
	RUNTIME_CONFIGURATION_ISSUE_OBSERVATION,
	RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION,
} from "./observations.js";

export interface RuntimeConfigurationLayerRegistryOptions {
	readonly observationPublisher?: RuntimeObservationPublisher;
}

interface PublishedLayerSource {
	readonly revision: string;
	readonly layers: readonly RuntimeConfigurationLayerSnapshot[];
}

/** 汇总 Host/Agent 等动态 Source 发布的产品无关 Layer generation。 */
export class RuntimeConfigurationLayerRegistry {
	private readonly sources = new Map<string, PublishedLayerSource>();
	private readonly observations: RuntimeObservationPublisher | undefined;
	private version = 0;
	private closed = false;
	private cachedSnapshot: RuntimeConfigurationLayerRegistrySnapshot | undefined;

	constructor(options: RuntimeConfigurationLayerRegistryOptions = {}) {
		this.observations = options.observationPublisher;
	}

	replaceSource(
		source: RuntimeConfigurationSourceRef,
		layersInput: readonly RuntimeConfigurationLayerSnapshot[],
	): RuntimeConfigurationLayerSourcePublishResult {
		this.assertOpen();
		let sourceId: string | undefined;
		let sourceRevision: string | undefined;
		try {
			const normalizedSource = normalizeSource(source);
			sourceId = normalizedSource.id;
			sourceRevision = normalizedSource.revision;
			const current = this.sources.get(sourceId);
			if (current?.revision === sourceRevision) {
				return Object.freeze({ status: "unchanged", sourceRevision });
			}

			const layers = normalizeRuntimeConfigurationLayers(layersInput);
			const ownership = this.layerOwnership(sourceId);
			for (const layer of layers) {
				const owner = ownership.get(layer.id);
				if (owner) throw runtimeConfigurationLayerSourceConflictError(layer.id, owner, sourceId);
			}
			const combined = normalizeRuntimeConfigurationLayers([...this.layersExcept(sourceId), ...layers]);
			const previousIds = new Set(current?.layers.map(({ id }) => id) ?? []);
			const nextIds = new Set(layers.map(({ id }) => id));
			const removedLayerIds = [...previousIds].filter((id) => !nextIds.has(id)).sort(compareString);
			this.sources.set(sourceId, Object.freeze({ revision: sourceRevision, layers }));
			this.version += 1;
			this.cachedSnapshot = createSnapshot(this.version, false, this.sources, combined);
			this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
				operation: "layer.publish",
				phase: "completed",
				sourceId,
				sourceRevision,
				layerCount: layers.length,
				removedCount: removedLayerIds.length,
			});
			return Object.freeze({
				status: "published",
				sourceRevision,
				layerIds: Object.freeze([...nextIds].sort(compareString)),
				removedLayerIds: Object.freeze(removedLayerIds),
			});
		} catch (error) {
			this.observeFailure(error, sourceId, sourceRevision);
			throw error;
		}
	}

	removeSource(sourceId: string): boolean {
		this.assertOpen();
		const normalized = normalizeId(sourceId, "Runtime Configuration layer source id");
		const current = this.sources.get(normalized);
		if (!current) return false;
		this.sources.delete(normalized);
		this.version += 1;
		this.cachedSnapshot = undefined;
		this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
			operation: "layer.remove",
			phase: "completed",
			sourceId: normalized,
			sourceRevision: current.revision,
			removedCount: current.layers.length,
		});
		return true;
	}

	snapshot(): RuntimeConfigurationLayerRegistrySnapshot {
		if (!this.cachedSnapshot) {
			this.cachedSnapshot = createSnapshot(
				this.version,
				this.closed,
				this.sources,
				normalizeRuntimeConfigurationLayers([...this.sources.values()].flatMap(({ layers }) => layers)),
			);
		}
		return this.cachedSnapshot;
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.sources.clear();
		this.cachedSnapshot = createSnapshot(this.version, true, this.sources, []);
	}

	private assertOpen(): void {
		if (this.closed) throw runtimeConfigurationRegistryClosedError();
	}

	private layersExcept(sourceId: string): RuntimeConfigurationLayerSnapshot[] {
		return [...this.sources.entries()].filter(([id]) => id !== sourceId).flatMap(([, { layers }]) => layers);
	}

	private layerOwnership(excludedSourceId: string): Map<string, string> {
		const owners = new Map<string, string>();
		for (const [sourceId, { layers }] of this.sources) {
			if (sourceId === excludedSourceId) continue;
			for (const layer of layers) owners.set(layer.id, sourceId);
		}
		return owners;
	}

	private observeFailure(error: unknown, sourceId?: string, sourceRevision?: string): void {
		const code =
			error instanceof RuntimeConfigurationError &&
			error.code === RUNTIME_CONFIGURATION_ERROR_CODES.LAYER_SOURCE_CONFLICT
				? "layer-source-conflict"
				: "layer-invalid";
		this.observations?.record(RUNTIME_CONFIGURATION_ISSUE_OBSERVATION, {
			operation: "layer.publish",
			code,
			...(sourceId ? { sourceId } : {}),
			...(sourceRevision ? { sourceRevision } : {}),
			failure: runtimeObservationFailure(error),
		});
		this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
			operation: "layer.publish",
			phase: "failed",
			...(sourceId ? { sourceId } : {}),
			...(sourceRevision ? { sourceRevision } : {}),
			failure: runtimeObservationFailure(error),
		});
	}
}

function createSnapshot(
	version: number,
	closed: boolean,
	sources: ReadonlyMap<string, PublishedLayerSource>,
	layers: readonly RuntimeConfigurationLayerSnapshot[],
): RuntimeConfigurationLayerRegistrySnapshot {
	return Object.freeze({
		version,
		closed,
		sources: Object.freeze(
			[...sources.entries()]
				.sort(([left], [right]) => compareString(left, right))
				.map(([sourceId, source]) =>
					Object.freeze({
						sourceId,
						sourceRevision: source.revision,
						layerIds: Object.freeze(source.layers.map(({ id }) => id).sort(compareString)),
					}),
				),
		),
		layers,
	});
}

function normalizeId(value: string, label: string): string {
	if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
		throw invalidRuntimeConfigurationLayerError(`${label} must be a non-empty trimmed string`);
	}
	return value;
}

function normalizeSource(source: RuntimeConfigurationSourceRef): RuntimeConfigurationSourceRef {
	if (!source || typeof source !== "object") {
		throw invalidRuntimeConfigurationLayerError("Runtime Configuration layer source must be an object");
	}
	return Object.freeze({
		id: normalizeId(source.id, "Runtime Configuration layer source id"),
		revision: normalizeId(source.revision, "Runtime Configuration layer source revision"),
	});
}

function compareString(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
