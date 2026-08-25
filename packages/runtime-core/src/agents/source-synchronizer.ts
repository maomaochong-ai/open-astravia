import { type RuntimeObservationPublisher, runtimeObservationFailure } from "../observation/index.js";
import type {
	RuntimeAgentDefinitionSource,
	RuntimeAgentDefinitionSourceSnapshot,
	RuntimeAgentDefinitionSynchronizationFailure,
	RuntimeAgentDefinitionSynchronizationResult,
	RuntimeAgentDefinitionSynchronizerSnapshot,
} from "./contracts.js";
import { invalidRuntimeAgentDefinitionError, runtimeAgentRegistryClosedError } from "./errors.js";
import { RUNTIME_AGENT_LIFECYCLE_OBSERVATION } from "./observations.js";
import type { RuntimeAgentRegistry } from "./registry.js";

export interface RuntimeAgentDefinitionSynchronizerOptions {
	readonly source: RuntimeAgentDefinitionSource;
	readonly registry: RuntimeAgentRegistry;
	readonly now?: () => number;
	readonly observationPublisher?: RuntimeObservationPublisher;
}

/** 将任意宿主 Source 的完整快照同步到通用 Registry，失败时保留 last-known-good。 */
export class RuntimeAgentDefinitionSynchronizer {
	private readonly source: RuntimeAgentDefinitionSource;
	private readonly registry: RuntimeAgentRegistry;
	private readonly now: () => number;
	private readonly observations?: RuntimeObservationPublisher;
	private readonly activeLoads = new Set<AbortController>();
	private requestedSequence = 0;
	private publishedRevision?: string;
	private desiredRevision?: string;
	private failure?: RuntimeAgentDefinitionSynchronizationFailure;
	private phase: RuntimeAgentDefinitionSynchronizerSnapshot["phase"] = "idle";
	private unsubscribe?: () => void;
	private closed = false;

	constructor(options: RuntimeAgentDefinitionSynchronizerOptions) {
		if (!options.source.id || options.source.id.trim() === "") {
			throw invalidRuntimeAgentDefinitionError("Runtime Agent definition source id must be a non-empty string");
		}
		this.source = options.source;
		this.registry = options.registry;
		this.now = options.now ?? Date.now;
		this.observations = options.observationPublisher;
	}

	async start(
		signal: AbortSignal = new AbortController().signal,
	): Promise<RuntimeAgentDefinitionSynchronizationResult> {
		if (this.closed) throw runtimeAgentRegistryClosedError();
		if (!this.unsubscribe && this.source.subscribe) {
			this.unsubscribe = this.source.subscribe(() => {
				void this.refresh().catch(() => undefined);
			});
		}
		return this.refresh(signal);
	}

	async refresh(
		signal: AbortSignal = new AbortController().signal,
	): Promise<RuntimeAgentDefinitionSynchronizationResult> {
		if (this.closed) throw runtimeAgentRegistryClosedError();
		const sequence = ++this.requestedSequence;
		const controller = new AbortController();
		this.activeLoads.add(controller);
		this.phase = "syncing";
		this.failure = undefined;
		this.observations?.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
			operation: "source.sync",
			phase: "started",
			sourceId: this.source.id,
		});
		try {
			const loaded: unknown = await this.source.load(AbortSignal.any([signal, controller.signal]));
			const snapshot = validateSourceSnapshot(loaded);
			if (this.closed) throw runtimeAgentRegistryClosedError();
			if (sequence !== this.requestedSequence) {
				this.observations?.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
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
				this.observations?.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
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
			this.observations?.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
				operation: "source.sync",
				phase: "completed",
				sourceId: this.source.id,
				sourceRevision: snapshot.revision,
				definitionCount: result.revisions.length,
				removedCount: result.removedAgentIds.length,
			});
			return Object.freeze({
				status: "applied",
				sourceRevision: snapshot.revision,
				publishedRevisionIds: Object.freeze(result.revisions.map(({ id }) => id)),
				removedAgentIds: result.removedAgentIds,
			});
		} catch (error) {
			if (sequence === this.requestedSequence && !this.closed) {
				this.phase = "failed";
				this.failure = toFailure(error, this.now());
				this.observations?.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
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

	snapshot(): RuntimeAgentDefinitionSynchronizerSnapshot {
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

function validateSourceSnapshot(value: unknown): RuntimeAgentDefinitionSourceSnapshot {
	if (!value || typeof value !== "object") {
		throw invalidRuntimeAgentDefinitionError("Runtime Agent source snapshot must be an object");
	}
	const { revision, definitions } = value as {
		readonly revision?: unknown;
		readonly definitions?: unknown;
	};
	if (typeof revision !== "string" || revision.trim() === "") {
		throw invalidRuntimeAgentDefinitionError("Runtime Agent source revision must be a non-empty string");
	}
	if (!Array.isArray(definitions)) {
		throw invalidRuntimeAgentDefinitionError("Runtime Agent source definitions must be an array");
	}
	return { revision, definitions } as RuntimeAgentDefinitionSourceSnapshot;
}

function toFailure(error: unknown, occurredAt: number): RuntimeAgentDefinitionSynchronizationFailure {
	const failure = runtimeObservationFailure(error);
	return Object.freeze({
		occurredAt,
		errorName: failure.errorName,
		...(failure.errorCode ? { errorCode: failure.errorCode } : {}),
	});
}
