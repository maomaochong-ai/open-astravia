import { type RuntimeObservationPublisher, runtimeObservationFailure } from "../observation/index.js";
import type {
	ResolvedRuntimeConfigurationEntry,
	RuntimeConfigurationDefinition,
	RuntimeConfigurationDiagnostic,
	RuntimeConfigurationJsonObject,
	RuntimeConfigurationLayerSnapshot,
	RuntimeConfigurationRevision,
	RuntimeConfigurationSnapshot,
	RuntimeConfigurationSnapshotLease,
} from "./contracts.js";
import {
	cloneAndFreezeConfigurationObject,
	isRuntimeConfigurationJsonObject,
	mergeRuntimeConfigurationObjects,
} from "./json.js";
import { normalizeRuntimeConfigurationLayers } from "./layer-normalization.js";
import {
	RUNTIME_CONFIGURATION_ISSUE_OBSERVATION,
	RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION,
} from "./observations.js";
import type { RuntimeConfigurationRegistry } from "./registry.js";

export interface RuntimeConfigurationResolverOptions {
	readonly observationPublisher?: RuntimeObservationPublisher;
}

/** 将当前 Definition generations 与 Host 提供的 Layer 解析为持有 lease 的不可变配置快照。 */
export class RuntimeConfigurationResolver {
	private readonly observations: RuntimeObservationPublisher | undefined;

	constructor(
		private readonly registry: RuntimeConfigurationRegistry,
		options: RuntimeConfigurationResolverOptions = {},
	) {
		this.observations = options.observationPublisher;
	}

	capture(layers: readonly RuntimeConfigurationLayerSnapshot[]): RuntimeConfigurationSnapshotLease {
		const definitionLease = this.registry.acquireSnapshot();
		let normalizedLayers: readonly RuntimeConfigurationLayerSnapshot[];
		try {
			normalizedLayers = normalizeRuntimeConfigurationLayers(layers);
		} catch (error) {
			void definitionLease.release().catch(() => undefined);
			this.observations?.record(RUNTIME_CONFIGURATION_ISSUE_OBSERVATION, {
				operation: "snapshot.resolve",
				code: "layer-invalid",
				failure: runtimeObservationFailure(error),
			});
			this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
				operation: "snapshot.resolve",
				phase: "failed",
				layerCount: layers.length,
				failure: runtimeObservationFailure(error),
			});
			throw error;
		}

		const revisions = definitionLease.snapshot.revisions;
		const knownConfigurationIds = new Set(revisions.map(({ configurationId }) => configurationId));
		const diagnostics: RuntimeConfigurationDiagnostic[] = [];
		for (const layer of normalizedLayers) {
			for (const configurationId of Object.keys(layer.values).sort(compareString)) {
				if (knownConfigurationIds.has(configurationId)) continue;
				const diagnostic = Object.freeze({
					code: "unknown-definition" as const,
					configurationId,
					layerId: layer.id,
				});
				diagnostics.push(diagnostic);
				this.observations?.record(RUNTIME_CONFIGURATION_ISSUE_OBSERVATION, {
					operation: "snapshot.resolve",
					code: "layer-definition-unknown",
					configurationId,
					layerId: layer.id,
				});
			}
		}

		const entries = revisions.map((revision) => this.resolveDefinition(revision, normalizedLayers, diagnostics));
		const snapshot = createSnapshot(definitionLease.snapshot.version, normalizedLayers, entries, diagnostics);
		this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
			operation: "snapshot.resolve",
			phase: "completed",
			definitionCount: entries.length,
			layerCount: normalizedLayers.length,
			diagnosticCount: diagnostics.length,
		});
		let released = false;
		return Object.freeze({
			snapshot,
			release: async () => {
				if (released) return;
				released = true;
				await definitionLease.release();
			},
		});
	}

	private resolveDefinition(
		revision: RuntimeConfigurationRevision,
		layers: readonly RuntimeConfigurationLayerSnapshot[],
		diagnostics: RuntimeConfigurationDiagnostic[],
	): ResolvedRuntimeConfigurationEntry {
		const definition = revision.definition;
		let value = definition.defaultValue;
		const appliedLayerIds: string[] = [];
		for (const layer of layers) {
			const patch = layer.values[definition.id];
			if (!patch) continue;
			try {
				const candidate = mergeRuntimeConfigurationObjects(value, patch);
				const decoded = definition.codec.decode(candidate);
				if (!isRuntimeConfigurationJsonObject(decoded)) {
					throw new TypeError("Runtime Configuration codec returned a non-JSON object");
				}
				value = cloneAndFreezeConfigurationObject(decoded);
				appliedLayerIds.push(layer.id);
			} catch (error) {
				const failure = safeFailure(error);
				const diagnostic = Object.freeze({
					code: "invalid-layer-value" as const,
					configurationId: definition.id,
					layerId: layer.id,
					...failure,
				});
				diagnostics.push(diagnostic);
				this.observations?.record(RUNTIME_CONFIGURATION_ISSUE_OBSERVATION, {
					operation: "snapshot.resolve",
					code: "layer-value-invalid",
					configurationId: definition.id,
					definitionRevisionId: revision.id,
					sourceId: revision.source.id,
					layerId: layer.id,
					failure: runtimeObservationFailure(error),
				});
			}
		}
		return Object.freeze({
			configurationId: definition.id,
			definitionRevisionId: revision.id,
			definitionSourceId: revision.source.id,
			schemaVersion: definition.schemaVersion,
			apply: definition.apply,
			descriptor: definition.descriptor,
			defaultValue: definition.defaultValue,
			value,
			appliedLayerIds: Object.freeze(appliedLayerIds),
		});
	}
}

function createSnapshot(
	definitionVersion: number,
	layers: readonly RuntimeConfigurationLayerSnapshot[],
	entries: readonly ResolvedRuntimeConfigurationEntry[],
	diagnostics: readonly RuntimeConfigurationDiagnostic[],
): RuntimeConfigurationSnapshot {
	const entryById = new Map(entries.map((entry) => [entry.configurationId, entry] as const));
	const layerRefs = Object.freeze(
		layers.map(({ id, revision, precedence }) => Object.freeze({ id, revision, precedence })),
	);
	const id = [
		`definitions@${definitionVersion}`,
		...layerRefs.map((layer) => `${encodeURIComponent(layer.id)}@${encodeURIComponent(layer.revision)}`),
	].join("|");
	return Object.freeze({
		id,
		definitionVersion,
		layers: layerRefs,
		entries: Object.freeze([...entries]),
		diagnostics: Object.freeze([...diagnostics]),
		get(configurationId: string) {
			return entryById.get(configurationId)?.value;
		},
		read<TValue extends RuntimeConfigurationJsonObject>(definition: RuntimeConfigurationDefinition<TValue>) {
			const entry = entryById.get(definition.id);
			return entry?.schemaVersion === definition.schemaVersion ? (entry.value as TValue) : undefined;
		},
	});
}

function safeFailure(error: unknown): { readonly errorName: string; readonly errorCode?: string } {
	const errorName = error instanceof Error ? error.name : "UnknownError";
	if (!error || typeof error !== "object" || !("code" in error)) return { errorName };
	const code = error.code;
	return typeof code === "string" || typeof code === "number"
		? { errorName, errorCode: String(code).slice(0, 100) }
		: { errorName };
}

function compareString(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
