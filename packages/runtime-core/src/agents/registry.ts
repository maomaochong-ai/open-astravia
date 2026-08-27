import { createRuntimeId } from "../id-generator.js";
import { RetryableCloseController } from "../lifecycle/retryable-cleanup.js";
import { type RuntimeObservationPublisher, runtimeObservationFailure } from "../observation/index.js";
import type {
	RuntimeAgentDefinition,
	RuntimeAgentDefinitionCandidate,
	RuntimeAgentDefinitionSourceRef,
	RuntimeAgentPublishResult,
	RuntimeAgentRegistryEntrySnapshot,
	RuntimeAgentRegistrySnapshot,
	RuntimeAgentRevision,
	RuntimeAgentRevisionLease,
	RuntimeAgentSourcePublishResult,
} from "./contracts.js";
import { defineRuntimeAgent } from "./contracts.js";
import {
	invalidRuntimeAgentDefinitionError,
	runtimeAgentNotFoundError,
	runtimeAgentRegistryClosedError,
	runtimeAgentSourceConflictError,
	runtimeAgentUnavailableError,
} from "./errors.js";
import { RUNTIME_AGENT_LIFECYCLE_OBSERVATION } from "./observations.js";

export interface RuntimeAgentRegistryOptions {
	readonly createRevisionId?: () => string;
	readonly now?: () => number;
	readonly observationPublisher?: RuntimeObservationPublisher;
}

interface RuntimeAgentRegistryEntry {
	readonly agentId: string;
	readonly sourceId: string;
	state: "active" | "retired";
	current?: RuntimeAgentGeneration;
	lastRevisionId: string;
}

interface RuntimeAgentGeneration {
	readonly revision: RuntimeAgentRevision;
	activeLeases: number;
	retired: boolean;
	disposePromise?: Promise<void>;
	readonly unusedWaiters: Array<() => void>;
}

interface PreparedCandidate {
	readonly source: RuntimeAgentDefinitionSourceRef;
	readonly definition: RuntimeAgentDefinition;
}

/** 多个平级 Agent Definition 的原子 revision 与 lease 所有者。 */
export class RuntimeAgentRegistry {
	private readonly entries = new Map<string, RuntimeAgentRegistryEntry>();
	private readonly generations = new Set<RuntimeAgentGeneration>();
	private readonly revisionIds = new Set<string>();
	private readonly createRevisionId: () => string;
	private readonly now: () => number;
	private readonly observations?: RuntimeObservationPublisher;
	private readonly closeController: RetryableCloseController;
	private sequence = 0;
	private closed = false;

	constructor(options: RuntimeAgentRegistryOptions = {}) {
		this.createRevisionId = options.createRevisionId ?? createRuntimeId;
		this.now = options.now ?? Date.now;
		this.observations = options.observationPublisher;
		this.closeController = new RetryableCloseController({ cleanup: () => this.disposeAll() });
	}

	upsert(candidate: RuntimeAgentDefinitionCandidate): RuntimeAgentPublishResult {
		this.assertOpen();
		const prepared = validateCandidate(candidate);
		this.assertSourceOwnership(prepared.definition.id, prepared.source.id);
		const generation = this.createGeneration(prepared);
		const previous = this.entries.get(prepared.definition.id)?.current;

		this.generations.add(generation);
		this.entries.set(prepared.definition.id, {
			agentId: prepared.definition.id,
			sourceId: prepared.source.id,
			state: "active",
			current: generation,
			lastRevisionId: generation.revision.id,
		});
		if (previous) this.retireGeneration(previous);
		this.observations?.record(
			RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
			{
				operation: "revision.publish",
				phase: "completed",
				sourceId: prepared.source.id,
				sourceRevision: prepared.source.revision,
				definitionCount: 1,
			},
			{ agentId: prepared.definition.id, revisionId: generation.revision.id },
		);
		return Object.freeze({ status: "published", revision: generation.revision });
	}

	/** 用一个完整 Source Snapshot 原子替换该 Source 当前拥有的 Agent 集合。 */
	replaceSource(
		source: RuntimeAgentDefinitionSourceRef,
		definitions: readonly RuntimeAgentDefinition[],
	): RuntimeAgentSourcePublishResult {
		this.assertOpen();
		const preparedSource = validateSource(source);
		const candidates = definitions.map((definition) => validateCandidate({ source: preparedSource, definition }));
		const candidateIds = new Set<string>();
		for (const candidate of candidates) {
			if (candidateIds.has(candidate.definition.id)) {
				throw invalidRuntimeAgentDefinitionError(
					`Duplicate Runtime Agent definition id in source ${preparedSource.id}: ${candidate.definition.id}`,
				);
			}
			candidateIds.add(candidate.definition.id);
			this.assertSourceOwnership(candidate.definition.id, preparedSource.id);
		}

		const nextGenerations = candidates.map((candidate) => this.createGeneration(candidate));
		const removedAgentIds = [...this.entries.values()]
			.filter((entry) => entry.sourceId === preparedSource.id && !candidateIds.has(entry.agentId))
			.map(({ agentId }) => agentId)
			.sort(compareString);
		const previousGenerations: RuntimeAgentGeneration[] = [];

		for (const agentId of removedAgentIds) {
			const entry = this.entries.get(agentId);
			if (entry?.current) previousGenerations.push(entry.current);
			this.entries.delete(agentId);
		}
		for (const generation of nextGenerations) {
			const agentId = generation.revision.agentId;
			const previous = this.entries.get(agentId)?.current;
			if (previous) previousGenerations.push(previous);
			this.generations.add(generation);
			this.entries.set(agentId, {
				agentId,
				sourceId: preparedSource.id,
				state: "active",
				current: generation,
				lastRevisionId: generation.revision.id,
			});
		}
		for (const generation of previousGenerations) this.retireGeneration(generation);
		this.observations?.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
			operation: "revision.publish",
			phase: "completed",
			sourceId: preparedSource.id,
			sourceRevision: preparedSource.revision,
			definitionCount: nextGenerations.length,
			removedCount: removedAgentIds.length,
		});

		return Object.freeze({
			status: "published",
			revisions: Object.freeze(nextGenerations.map(({ revision }) => revision)),
			removedAgentIds: Object.freeze(removedAgentIds),
		});
	}

	acquire(agentId: string): RuntimeAgentRevisionLease {
		this.assertOpen();
		const entry = this.entries.get(agentId);
		if (!entry) throw runtimeAgentNotFoundError(agentId);
		const generation = entry.current;
		if (!generation || entry.state !== "active") throw runtimeAgentUnavailableError(agentId);
		generation.activeLeases += 1;
		this.observations?.record(
			RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
			{ operation: "revision.acquire", phase: "completed" },
			{ agentId, revisionId: generation.revision.id },
		);
		let leaseReleased = false;
		let releaseCompleted = false;
		return Object.freeze({
			revision: generation.revision,
			release: async () => {
				if (releaseCompleted) return;
				if (!leaseReleased) {
					leaseReleased = true;
					generation.activeLeases -= 1;
					if (generation.activeLeases === 0) {
						for (const resolve of generation.unusedWaiters.splice(0)) resolve();
					}
				}
				try {
					await this.disposeIfRetired(generation);
					releaseCompleted = true;
					this.observations?.record(
						RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
						{ operation: "revision.release", phase: "completed" },
						{ agentId, revisionId: generation.revision.id },
					);
				} catch (error) {
					this.observations?.record(
						RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
						{
							operation: "revision.release",
							phase: "failed",
							failure: runtimeObservationFailure(error),
						},
						{ agentId, revisionId: generation.revision.id },
					);
					throw error;
				}
			},
		});
	}

	/** 保留 Agent identity 与 Source ownership，但阻止新租约。 */
	retire(agentId: string): boolean {
		this.assertOpen();
		const entry = this.entries.get(agentId);
		if (!entry || entry.state === "retired") return false;
		entry.state = "retired";
		const current = entry.current;
		entry.current = undefined;
		if (current) this.retireGeneration(current);
		this.observations?.record(
			RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
			{ operation: "revision.retire", phase: "completed", sourceId: entry.sourceId },
			{ agentId, revisionId: entry.lastRevisionId },
		);
		return true;
	}

	/** 从发现面移除 Agent；已有 revision lease 继续有效直至释放。 */
	remove(agentId: string, expectedRevisionId?: string): boolean {
		this.assertOpen();
		const entry = this.entries.get(agentId);
		if (!entry) return false;
		if (expectedRevisionId !== undefined && entry.current?.revision.id !== expectedRevisionId) return false;
		this.entries.delete(agentId);
		if (entry.current) this.retireGeneration(entry.current);
		this.observations?.record(
			RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
			{ operation: "revision.remove", phase: "completed", sourceId: entry.sourceId },
			{ agentId, revisionId: entry.lastRevisionId },
		);
		return true;
	}

	snapshot(): RuntimeAgentRegistrySnapshot {
		const entries = [...this.entries.values()].map(toEntrySnapshot).sort(compareEntrySnapshot);
		let retiredRevisionCount = 0;
		let activeLeaseCount = 0;
		for (const generation of this.generations) {
			if (generation.retired) retiredRevisionCount += 1;
			activeLeaseCount += generation.activeLeases;
		}
		return Object.freeze({
			closed: this.closed,
			entries: Object.freeze(entries),
			revisionCount: this.generations.size,
			retiredRevisionCount,
			activeLeaseCount,
		});
	}

	close(): Promise<void> {
		if (!this.closed) {
			this.closed = true;
			for (const generation of this.generations) generation.retired = true;
		}
		return this.closeController.run();
	}

	private assertOpen(): void {
		if (this.closed) throw runtimeAgentRegistryClosedError();
	}

	private assertSourceOwnership(agentId: string, sourceId: string): void {
		const current = this.entries.get(agentId);
		if (current && current.sourceId !== sourceId) {
			throw runtimeAgentSourceConflictError(agentId, current.sourceId, sourceId);
		}
	}

	private createGeneration(candidate: PreparedCandidate): RuntimeAgentGeneration {
		this.sequence += 1;
		const revisionId = this.createRevisionId();
		if (!revisionId || this.revisionIds.has(revisionId)) {
			throw invalidRuntimeAgentDefinitionError(`Invalid or duplicate Runtime Agent revision id: ${revisionId}`);
		}
		this.revisionIds.add(revisionId);
		const revision: RuntimeAgentRevision = Object.freeze({
			id: revisionId,
			sequence: this.sequence,
			agentId: candidate.definition.id,
			source: candidate.source,
			publishedAt: this.now(),
			definition: defineRuntimeAgent(candidate.definition),
		});
		return {
			revision,
			activeLeases: 0,
			retired: false,
			unusedWaiters: [],
		};
	}

	private retireGeneration(generation: RuntimeAgentGeneration): void {
		generation.retired = true;
		void this.disposeIfRetired(generation).catch(() => undefined);
	}

	private async disposeIfRetired(generation: RuntimeAgentGeneration): Promise<void> {
		if (!generation.retired || generation.activeLeases > 0) return;
		if (!generation.disposePromise) {
			const operation = Promise.resolve()
				.then(() => generation.revision.definition.dispose?.())
				.then(() => {
					this.observations?.record(
						RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
						{ operation: "revision.dispose", phase: "completed" },
						{ agentId: generation.revision.agentId, revisionId: generation.revision.id },
					);
					this.generations.delete(generation);
				})
				.catch((error: unknown) => {
					this.observations?.record(
						RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
						{
							operation: "revision.dispose",
							phase: "failed",
							failure: runtimeObservationFailure(error),
						},
						{ agentId: generation.revision.agentId, revisionId: generation.revision.id },
					);
					throw error;
				});
			const tracked = operation.finally(() => {
				if (generation.disposePromise === tracked) generation.disposePromise = undefined;
			});
			generation.disposePromise = tracked;
		}
		await generation.disposePromise;
	}

	private async disposeAll(): Promise<void> {
		const generations = [...this.generations];
		const results = await Promise.allSettled(
			generations.map(async (generation) => {
				await waitUntilUnused(generation);
				await this.disposeIfRetired(generation);
			}),
		);
		const errors = new Set<unknown>();
		for (const result of results) {
			if (result.status === "rejected") errors.add(result.reason);
		}
		if (errors.size > 0) {
			throw new AggregateError([...errors], "Failed to dispose one or more Runtime Agent revisions");
		}
		this.entries.clear();
	}
}

function validateCandidate(candidate: RuntimeAgentDefinitionCandidate): PreparedCandidate {
	const source = validateSource(candidate.source);
	const definition = candidate.definition;
	if (!definition || typeof definition !== "object") {
		throw invalidRuntimeAgentDefinitionError("Runtime Agent definition must be an object");
	}
	assertNonEmptyId(definition.id, "Runtime Agent definition id");
	if (typeof definition.createInstance !== "function") {
		throw invalidRuntimeAgentDefinitionError(`Runtime Agent ${definition.id} must define createInstance()`);
	}
	if (definition.dispose !== undefined && typeof definition.dispose !== "function") {
		throw invalidRuntimeAgentDefinitionError(`Runtime Agent ${definition.id} dispose must be a function`);
	}
	return { source, definition };
}

function validateSource(source: RuntimeAgentDefinitionSourceRef): RuntimeAgentDefinitionSourceRef {
	if (!source || typeof source !== "object") {
		throw invalidRuntimeAgentDefinitionError("Runtime Agent source must be an object");
	}
	assertNonEmptyId(source.id, "Runtime Agent source id");
	assertNonEmptyId(source.revision, "Runtime Agent source revision");
	return Object.freeze({ id: source.id, revision: source.revision });
}

function assertNonEmptyId(value: string, label: string): void {
	if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
		throw invalidRuntimeAgentDefinitionError(`${label} must be a non-empty trimmed string`);
	}
}

function toEntrySnapshot(entry: RuntimeAgentRegistryEntry): RuntimeAgentRegistryEntrySnapshot {
	return Object.freeze({
		agentId: entry.agentId,
		sourceId: entry.sourceId,
		state: entry.state,
		...(entry.current ? { currentRevisionId: entry.current.revision.id } : {}),
		lastRevisionId: entry.lastRevisionId,
	});
}

function compareEntrySnapshot(
	left: RuntimeAgentRegistryEntrySnapshot,
	right: RuntimeAgentRegistryEntrySnapshot,
): number {
	return compareString(left.agentId, right.agentId);
}

function compareString(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

async function waitUntilUnused(generation: RuntimeAgentGeneration): Promise<void> {
	if (generation.activeLeases === 0) return;
	await new Promise<void>((resolve) => {
		generation.unusedWaiters.push(resolve);
	});
}
