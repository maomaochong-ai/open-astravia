import { type RuntimeObservationPublisher, runtimeObservationFailure } from "../observation/index.js";
import type {
	RuntimeConfigurationDefinitionSource,
	RuntimeConfigurationDefinitionSourceSnapshot,
	RuntimeConfigurationDefinitionSynchronizationFailure,
	RuntimeConfigurationDefinitionSynchronizationResult,
	RuntimeConfigurationDefinitionSynchronizerSnapshot,
} from "./contracts.js";
import { invalidRuntimeConfigurationDefinitionError, runtimeConfigurationRegistryClosedError } from "./errors.js";
import { RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION } from "./observations.js";
import type { RuntimeConfigurationRegistry } from "./registry.js";

export interface RuntimeConfigurationDefinitionSynchronizerOptions {
	readonly source: RuntimeConfigurationDefinitionSource;
	readonly registry: RuntimeConfigurationRegistry;
	readonly now?: () => number;
	readonly observationPublisher?: RuntimeObservationPublisher;
}

/** 将任意 Host Source 的完整配置快照同步到 Registry，失败时保留 last-known-good。 */
export class RuntimeConfigurationDefinitionSynchronizer {
	private readonly source: RuntimeConfigurationDefinitionSource;
	private readonly registry: RuntimeConfigurationRegistry;
	private readonly now: () => number;
	private readonly observations: RuntimeObservationPublisher | undefined;
	private readonly activeLoads = new Set<AbortController>();
	private requestedSequence = 0;
	private publishedRevision?: string;
	private desiredRevision?: string;
	private failure?: RuntimeConfigurationDefinitionSynchronizationFailure;
	private phase: RuntimeConfigurationDefinitionSynchronizerSnapshot["phase"] = "idle";
	private unsubscribe?: () => void;
	private closed = false;

	constructor(options: RuntimeConfigurationDefinitionSynchronizerOptions) {
		if (!options.source.id || options.source.id.trim() === "" || options.source.id !== options.source.id.trim()) {
			throw invalidRuntimeConfigurationDefinitionError(
				"Runtime Configuration definition source id must be a non-empty trimmed string",
			);
		}
		this.source = options.source;
		this.registry = options.registry;
		this.now = options.now ?? Date.now;
		this.observations = options.observationPublisher;
	}

	async start(
		signal: AbortSignal = new AbortController().signal,
	): Promise<RuntimeConfigurationDefinitionSynchronizationResult> {
		if (this.closed) throw runtimeConfigurationRegistryClosedError();
		if (!this.unsubscribe && this.source.subscribe) {
			this.unsubscribe = this.source.subscribe(() => {
				void this.refresh().catch(() => undefined);
			});
		}
		return this.refresh(signal);
	}

	async refresh(
		signal: AbortSignal = new AbortController().signal,
	): Promise<RuntimeConfigurationDefinitionSynchronizationResult> {
		if (this.closed) throw runtimeConfigurationRegistryClosedError();
		const sequence = ++this.requestedSequence;
		const controller = new AbortController();
		this.activeLoads.add(controller);
		this.phase = "syncing";
		this.failure = undefined;
		this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
			operation: "source.sync",
			phase: "started",
			sourceId: this.source.id,
		});
		try {
			const loaded: unknown = await this.source.load(AbortSignal.any([signal, controller.signal]));
			const snapshot = validateSourceSnapshot(loaded);
			if (this.closed) throw runtimeConfigurationRegistryClosedError();
			if (sequence !== this.requestedSequence) {
				this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
					operation: "source.sync",
					phase: "superseded",
					sourceId: this.source.id,
					sourceRevision: snapshot.revision,
				});
				return Object.freeze({ status: "superseded" });
			}
			this.desiredRevision = snapshot.revision;
			if (snapshot.revision === this.publishedRevision) {
				this.phase = "published";
				this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
					operation: "source.sync",
					phase: "unchanged",
					sourceId: this.source.id,
					sourceRevision: snapshot.revision,
				});
				return Object.freeze({ status: "unchanged", sourceRevision: snapshot.revision });
			}

			const result = this.registry.replaceSource(
				{ id: this.source.id, revision: snapshot.revision },
				snapshot.definitions,
			);
			this.publishedRevision = snapshot.revision;
			this.phase = "published";
			this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
				operation: "source.sync",
				phase: "completed",
				sourceId: this.source.id,
				sourceRevision: snapshot.revision,
				definitionCount: result.revisions.length,
				removedCount: result.removedConfigurationIds.length,
			});
			return Object.freeze({
				status: "applied",
				sourceRevision: snapshot.revision,
				publishedRevisionIds: Object.freeze(result.revisions.map(({ id }) => id)),
				removedConfigurationIds: result.removedConfigurationIds,
			});
		} catch (error) {
			if (sequence === this.requestedSequence && !this.closed) {
				this.phase = "failed";
				this.failure = toFailure(error, this.now());
				this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
					operation: "source.sync",
					phase: "failed",
					sourceId: this.source.id,
					failure: runtimeObservationFailure(error),
				});
			}
			throw error;
		} finally {
			this.activeLoads.delete(controller);
		}
	}

	snapshot(): RuntimeConfigurationDefinitionSynchronizerSnapshot {
		return Object.freeze({
			sourceId: this.source.id,
			phase: this.phase,
			...(this.desiredRevision ? { desiredRevision: this.desiredRevision } : {}),
			...(this.publishedRevision ? { publishedRevision: this.publishedRevision } : {}),
			...(this.failure ? { failure: this.failure } : {}),
		});
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.phase = "closed";
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		for (const controller of this.activeLoads) controller.abort();
		this.activeLoads.clear();
	}
}

function validateSourceSnapshot(value: unknown): RuntimeConfigurationDefinitionSourceSnapshot {
	if (!value || typeof value !== "object") {
		throw invalidRuntimeConfigurationDefinitionError("Runtime Configuration source snapshot must be an object");
	}
	const { revision, definitions } = value as { readonly revision?: unknown; readonly definitions?: unknown };
	if (typeof revision !== "string" || revision.trim() === "" || revision !== revision.trim()) {
		throw invalidRuntimeConfigurationDefinitionError(
			"Runtime Configuration source revision must be a non-empty trimmed string",
		);
	}
	if (!Array.isArray(definitions)) {
		throw invalidRuntimeConfigurationDefinitionError("Runtime Configuration source definitions must be an array");
	}
	return { revision, definitions } as RuntimeConfigurationDefinitionSourceSnapshot;
}

function toFailure(error: unknown, occurredAt: number): RuntimeConfigurationDefinitionSynchronizationFailure {
	const failure = runtimeObservationFailure(error);
	return Object.freeze({
		occurredAt,
		errorName: failure.errorName,
		...(failure.errorCode ? { errorCode: failure.errorCode } : {}),
	});
}
