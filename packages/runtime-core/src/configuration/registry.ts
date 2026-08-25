import { createRuntimeId } from "../id-generator.js";
import { type RuntimeObservationPublisher, runtimeObservationFailure } from "../observation/index.js";
import type {
	RuntimeConfigurationDefinition,
	RuntimeConfigurationDefinitionCandidate,
	RuntimeConfigurationDefinitionSetLease,
	RuntimeConfigurationDefinitionSetSnapshot,
	RuntimeConfigurationPublishResult,
	RuntimeConfigurationRegistryEntrySnapshot,
	RuntimeConfigurationRegistrySnapshot,
	RuntimeConfigurationRevision,
	RuntimeConfigurationRevisionLease,
	RuntimeConfigurationSourcePublishResult,
	RuntimeConfigurationSourceRef,
} from "./contracts.js";
import {
	invalidRuntimeConfigurationDefinitionError,
	RUNTIME_CONFIGURATION_ERROR_CODES,
	RuntimeConfigurationError,
	runtimeConfigurationNotFoundError,
	runtimeConfigurationRegistryClosedError,
	runtimeConfigurationSourceConflictError,
	runtimeConfigurationUnavailableError,
} from "./errors.js";
import { cloneAndFreezeConfigurationObject, isRuntimeConfigurationJsonObject } from "./json.js";
import {
	RUNTIME_CONFIGURATION_ISSUE_OBSERVATION,
	RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION,
	type RuntimeConfigurationIssueCode,
} from "./observations.js";

export interface RuntimeConfigurationRegistryOptions {
	readonly createRevisionId?: () => string;
	readonly now?: () => number;
	readonly observationPublisher?: RuntimeObservationPublisher;
}

interface RuntimeConfigurationRegistryEntry {
	readonly configurationId: string;
	readonly sourceId: string;
	state: "active" | "retired";
	current?: RuntimeConfigurationGeneration;
	lastRevisionId: string;
}

interface RuntimeConfigurationGeneration {
	readonly revision: RuntimeConfigurationRevision;
	activeLeases: number;
	retired: boolean;
	disposePromise?: Promise<void>;
	readonly unusedWaiters: Array<() => void>;
}

interface PreparedCandidate {
	readonly source: RuntimeConfigurationSourceRef;
	readonly definition: RuntimeConfigurationDefinition;
}

/** 产品无关的 Configuration Definition revision、Source ownership 与 lease 所有者。 */
export class RuntimeConfigurationRegistry {
	private readonly entries = new Map<string, RuntimeConfigurationRegistryEntry>();
	private readonly generations = new Set<RuntimeConfigurationGeneration>();
	private readonly revisionIds = new Set<string>();
	private readonly cleanupErrors = new Set<unknown>();
	private readonly createRevisionId: () => string;
	private readonly now: () => number;
	private readonly observations: RuntimeObservationPublisher | undefined;
	private sequence = 0;
	private version = 0;
	private closed = false;
	private closePromise?: Promise<void>;

	constructor(options: RuntimeConfigurationRegistryOptions = {}) {
		this.createRevisionId = options.createRevisionId ?? createRuntimeId;
		this.now = options.now ?? Date.now;
		this.observations = options.observationPublisher;
	}

	upsert(candidate: RuntimeConfigurationDefinitionCandidate): RuntimeConfigurationPublishResult {
		this.assertOpen();
		let prepared: PreparedCandidate;
		try {
			prepared = validateCandidate(candidate);
			this.assertSourceOwnership(prepared.definition.id, prepared.source.id);
		} catch (error) {
			this.observePublishFailure(error, candidate);
			throw error;
		}

		const generation = this.createGeneration(prepared);
		const previous = this.entries.get(prepared.definition.id)?.current;
		this.generations.add(generation);
		this.entries.set(prepared.definition.id, {
			configurationId: prepared.definition.id,
			sourceId: prepared.source.id,
			state: "active",
			current: generation,
			lastRevisionId: generation.revision.id,
		});
		if (previous) this.retireGeneration(previous);
		this.version += 1;
		this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
			operation: "definition.publish",
			phase: "completed",
			configurationId: prepared.definition.id,
			definitionRevisionId: generation.revision.id,
			sourceId: prepared.source.id,
			sourceRevision: prepared.source.revision,
			definitionCount: 1,
		});
		return Object.freeze({ status: "published", revision: generation.revision });
	}

	/** 用完整 Source Snapshot 原子替换该 Source 当前拥有的 Configuration Definition。 */
	replaceSource(
		source: RuntimeConfigurationSourceRef,
		definitions: readonly RuntimeConfigurationDefinition[],
	): RuntimeConfigurationSourcePublishResult {
		this.assertOpen();
		let preparedSource: RuntimeConfigurationSourceRef;
		let candidates: PreparedCandidate[];
		try {
			preparedSource = validateSource(source);
			candidates = definitions.map((definition) => validateCandidate({ source: preparedSource, definition }));
			const candidateIds = new Set<string>();
			for (const candidate of candidates) {
				if (candidateIds.has(candidate.definition.id)) {
					throw invalidRuntimeConfigurationDefinitionError(
						`Duplicate Runtime Configuration definition id in source ${preparedSource.id}: ${candidate.definition.id}`,
					);
				}
				candidateIds.add(candidate.definition.id);
				this.assertSourceOwnership(candidate.definition.id, preparedSource.id);
			}
		} catch (error) {
			this.observePublishFailure(error, { source, definition: definitions[0] });
			throw error;
		}

		const candidateIds = new Set(candidates.map(({ definition }) => definition.id));
		const nextGenerations = candidates.map((candidate) => this.createGeneration(candidate));
		const removedConfigurationIds = [...this.entries.values()]
			.filter((entry) => entry.sourceId === preparedSource.id && !candidateIds.has(entry.configurationId))
			.map(({ configurationId }) => configurationId)
			.sort(compareString);
		const previousGenerations: RuntimeConfigurationGeneration[] = [];

		for (const configurationId of removedConfigurationIds) {
			const entry = this.entries.get(configurationId);
			if (entry?.current) previousGenerations.push(entry.current);
			this.entries.delete(configurationId);
		}
		for (const generation of nextGenerations) {
			const configurationId = generation.revision.configurationId;
			const previous = this.entries.get(configurationId)?.current;
			if (previous) previousGenerations.push(previous);
			this.generations.add(generation);
			this.entries.set(configurationId, {
				configurationId,
				sourceId: preparedSource.id,
				state: "active",
				current: generation,
				lastRevisionId: generation.revision.id,
			});
		}
		for (const generation of previousGenerations) this.retireGeneration(generation);
		this.version += 1;
		this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
			operation: "definition.publish",
			phase: "completed",
			sourceId: preparedSource.id,
			sourceRevision: preparedSource.revision,
			definitionCount: nextGenerations.length,
			removedCount: removedConfigurationIds.length,
		});

		return Object.freeze({
			status: "published",
			revisions: Object.freeze(nextGenerations.map(({ revision }) => revision)),
			removedConfigurationIds: Object.freeze(removedConfigurationIds),
		});
	}

	acquire(configurationId: string): RuntimeConfigurationRevisionLease {
		this.assertOpen();
		const entry = this.entries.get(configurationId);
		if (!entry) throw runtimeConfigurationNotFoundError(configurationId);
		const generation = entry.current;
		if (!generation || entry.state !== "active") throw runtimeConfigurationUnavailableError(configurationId);
		this.acquireGeneration(generation);
		return this.createRevisionLease(generation);
	}

	/** 同步捕获当前全部 active Definition；调用方必须释放返回的 generation lease。 */
	acquireSnapshot(): RuntimeConfigurationDefinitionSetLease {
		this.assertOpen();
		const generations = [...this.entries.values()]
			.filter((entry): entry is RuntimeConfigurationRegistryEntry & { current: RuntimeConfigurationGeneration } =>
				Boolean(entry.state === "active" && entry.current),
			)
			.map(({ current }) => current)
			.sort((left, right) => compareString(left.revision.configurationId, right.revision.configurationId));
		for (const generation of generations) this.acquireGeneration(generation);
		const snapshot: RuntimeConfigurationDefinitionSetSnapshot = Object.freeze({
			version: this.version,
			revisions: Object.freeze(generations.map(({ revision }) => revision)),
		});
		let released = false;
		return Object.freeze({
			snapshot,
			release: async () => {
				if (released) return;
				released = true;
				const results = await Promise.allSettled(
					generations.map((generation) => this.releaseGeneration(generation)),
				);
				const errors = results
					.filter((result): result is PromiseRejectedResult => result.status === "rejected")
					.map(({ reason }) => reason);
				if (errors.length > 0) {
					throw new AggregateError(errors, "Failed to release Runtime Configuration definition snapshot");
				}
			},
		});
	}

	retire(configurationId: string): boolean {
		this.assertOpen();
		const entry = this.entries.get(configurationId);
		if (!entry || entry.state === "retired") return false;
		entry.state = "retired";
		const current = entry.current;
		entry.current = undefined;
		if (current) this.retireGeneration(current);
		this.version += 1;
		this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
			operation: "definition.retire",
			phase: "completed",
			configurationId,
			definitionRevisionId: entry.lastRevisionId,
			sourceId: entry.sourceId,
		});
		return true;
	}

	remove(configurationId: string): boolean {
		this.assertOpen();
		const entry = this.entries.get(configurationId);
		if (!entry) return false;
		this.entries.delete(configurationId);
		if (entry.current) this.retireGeneration(entry.current);
		this.version += 1;
		this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
			operation: "definition.remove",
			phase: "completed",
			configurationId,
			definitionRevisionId: entry.lastRevisionId,
			sourceId: entry.sourceId,
		});
		return true;
	}

	snapshot(): RuntimeConfigurationRegistrySnapshot {
		const entries = [...this.entries.values()].map(toEntrySnapshot).sort(compareEntrySnapshot);
		let retiredRevisionCount = 0;
		let activeLeaseCount = 0;
		for (const generation of this.generations) {
			if (generation.retired) retiredRevisionCount += 1;
			activeLeaseCount += generation.activeLeases;
		}
		return Object.freeze({
			version: this.version,
			closed: this.closed,
			entries: Object.freeze(entries),
			revisionCount: this.generations.size,
			retiredRevisionCount,
			activeLeaseCount,
		});
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.closed = true;
		for (const generation of this.generations) generation.retired = true;
		this.closePromise = this.disposeAll();
		return this.closePromise;
	}

	private assertOpen(): void {
		if (this.closed) throw runtimeConfigurationRegistryClosedError();
	}

	private assertSourceOwnership(configurationId: string, sourceId: string): void {
		const current = this.entries.get(configurationId);
		if (current && current.sourceId !== sourceId) {
			throw runtimeConfigurationSourceConflictError(configurationId, current.sourceId, sourceId);
		}
	}

	private createGeneration(candidate: PreparedCandidate): RuntimeConfigurationGeneration {
		this.sequence += 1;
		const revisionId = this.createRevisionId();
		if (!revisionId || this.revisionIds.has(revisionId)) {
			throw invalidRuntimeConfigurationDefinitionError(
				`Invalid or duplicate Runtime Configuration revision id: ${revisionId}`,
			);
		}
		this.revisionIds.add(revisionId);
		const revision: RuntimeConfigurationRevision = Object.freeze({
			id: revisionId,
			sequence: this.sequence,
			configurationId: candidate.definition.id,
			source: candidate.source,
			publishedAt: this.now(),
			definition: candidate.definition,
		});
		return { revision, activeLeases: 0, retired: false, unusedWaiters: [] };
	}

	private acquireGeneration(generation: RuntimeConfigurationGeneration): void {
		generation.activeLeases += 1;
		this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
			operation: "definition.acquire",
			phase: "completed",
			configurationId: generation.revision.configurationId,
			definitionRevisionId: generation.revision.id,
			sourceId: generation.revision.source.id,
		});
	}

	private createRevisionLease(generation: RuntimeConfigurationGeneration): RuntimeConfigurationRevisionLease {
		let released = false;
		return Object.freeze({
			revision: generation.revision,
			release: async () => {
				if (released) return;
				released = true;
				await this.releaseGeneration(generation);
			},
		});
	}

	private async releaseGeneration(generation: RuntimeConfigurationGeneration): Promise<void> {
		generation.activeLeases -= 1;
		if (generation.activeLeases === 0) {
			for (const resolve of generation.unusedWaiters.splice(0)) resolve();
		}
		try {
			await this.disposeIfRetired(generation);
			this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
				operation: "definition.release",
				phase: "completed",
				configurationId: generation.revision.configurationId,
				definitionRevisionId: generation.revision.id,
				sourceId: generation.revision.source.id,
			});
		} catch (error) {
			this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
				operation: "definition.release",
				phase: "failed",
				configurationId: generation.revision.configurationId,
				definitionRevisionId: generation.revision.id,
				sourceId: generation.revision.source.id,
				failure: runtimeObservationFailure(error),
			});
			throw error;
		}
	}

	private retireGeneration(generation: RuntimeConfigurationGeneration): void {
		generation.retired = true;
		void this.disposeIfRetired(generation).catch(() => undefined);
	}

	private async disposeIfRetired(generation: RuntimeConfigurationGeneration): Promise<void> {
		if (!generation.retired || generation.activeLeases > 0) return;
		if (!generation.disposePromise) {
			generation.disposePromise = Promise.resolve()
				.then(() => generation.revision.definition.dispose?.())
				.then(() => {
					this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
						operation: "definition.dispose",
						phase: "completed",
						configurationId: generation.revision.configurationId,
						definitionRevisionId: generation.revision.id,
						sourceId: generation.revision.source.id,
					});
				})
				.catch((error: unknown) => {
					this.cleanupErrors.add(error);
					this.observations?.record(RUNTIME_CONFIGURATION_ISSUE_OBSERVATION, {
						operation: "definition.dispose",
						code: "definition-dispose-failed",
						configurationId: generation.revision.configurationId,
						definitionRevisionId: generation.revision.id,
						sourceId: generation.revision.source.id,
						failure: runtimeObservationFailure(error),
					});
					throw error;
				})
				.finally(() => {
					this.generations.delete(generation);
				});
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
		this.entries.clear();
		const errors = new Set(this.cleanupErrors);
		for (const result of results) {
			if (result.status === "rejected") errors.add(result.reason);
		}
		if (errors.size > 0) {
			throw new AggregateError([...errors], "Failed to dispose one or more Runtime Configuration revisions");
		}
	}

	private observePublishFailure(
		error: unknown,
		candidate: {
			readonly source?: RuntimeConfigurationSourceRef;
			readonly definition?: RuntimeConfigurationDefinition;
		},
	): void {
		const configurationId = safeNonEmptyId(candidate.definition?.id);
		const sourceId = safeNonEmptyId(candidate.source?.id);
		const sourceRevision = safeNonEmptyId(candidate.source?.revision);
		const issueCode = configurationIssueCode(error);
		this.observations?.record(RUNTIME_CONFIGURATION_ISSUE_OBSERVATION, {
			operation: "definition.publish",
			code: issueCode,
			...(configurationId ? { configurationId } : {}),
			...(sourceId ? { sourceId } : {}),
			...(sourceRevision ? { sourceRevision } : {}),
			failure: runtimeObservationFailure(error),
		});
		this.observations?.record(RUNTIME_CONFIGURATION_LIFECYCLE_OBSERVATION, {
			operation: "definition.publish",
			phase: "failed",
			...(configurationId ? { configurationId } : {}),
			...(sourceId ? { sourceId } : {}),
			...(sourceRevision ? { sourceRevision } : {}),
			failure: runtimeObservationFailure(error),
		});
	}
}

function validateCandidate(candidate: RuntimeConfigurationDefinitionCandidate): PreparedCandidate {
	const source = validateSource(candidate.source);
	const definition = validateDefinition(candidate.definition);
	return { source, definition };
}

function validateDefinition(definition: RuntimeConfigurationDefinition): RuntimeConfigurationDefinition {
	if (!definition || typeof definition !== "object") {
		throw invalidRuntimeConfigurationDefinitionError("Runtime Configuration definition must be an object");
	}
	assertNonEmptyId(definition.id, "Runtime Configuration definition id");
	if (!Number.isInteger(definition.schemaVersion) || definition.schemaVersion < 1) {
		throw invalidRuntimeConfigurationDefinitionError(
			`Runtime Configuration ${definition.id} schemaVersion must be a positive integer`,
		);
	}
	if (!definition.descriptor || typeof definition.descriptor !== "object") {
		throw invalidRuntimeConfigurationDefinitionError(
			`Runtime Configuration ${definition.id} descriptor must be an object`,
		);
	}
	assertNonEmptyId(definition.descriptor.title, `Runtime Configuration ${definition.id} descriptor title`);
	if (!isRuntimeConfigurationJsonObject(definition.descriptor.schema)) {
		throw invalidRuntimeConfigurationDefinitionError(
			`Runtime Configuration ${definition.id} descriptor schema must be a JSON object`,
		);
	}
	if (
		definition.descriptor.presentation !== undefined &&
		!isRuntimeConfigurationJsonObject(definition.descriptor.presentation)
	) {
		throw invalidRuntimeConfigurationDefinitionError(
			`Runtime Configuration ${definition.id} descriptor presentation must be a JSON object`,
		);
	}
	const sensitivePaths = definition.descriptor.sensitivePaths ?? [];
	if (
		new Set(sensitivePaths).size !== sensitivePaths.length ||
		sensitivePaths.some((path) => typeof path !== "string" || !path.startsWith("/"))
	) {
		throw invalidRuntimeConfigurationDefinitionError(
			`Runtime Configuration ${definition.id} sensitive paths must be unique JSON Pointers`,
		);
	}
	if (!definition.codec || typeof definition.codec.decode !== "function") {
		throw invalidRuntimeConfigurationDefinitionError(
			`Runtime Configuration ${definition.id} must define codec.decode()`,
		);
	}
	if (definition.apply !== "next-turn" && definition.apply !== "next-session" && definition.apply !== "restart") {
		throw invalidRuntimeConfigurationDefinitionError(`Runtime Configuration ${definition.id} has invalid apply mode`);
	}
	if (definition.dispose !== undefined && typeof definition.dispose !== "function") {
		throw invalidRuntimeConfigurationDefinitionError(
			`Runtime Configuration ${definition.id} dispose must be a function`,
		);
	}

	const decode = definition.codec.decode.bind(definition.codec);
	let defaultValue: RuntimeConfigurationDefinition["defaultValue"];
	try {
		defaultValue = decode(cloneAndFreezeConfigurationObject(definition.defaultValue));
	} catch (error) {
		throw invalidRuntimeConfigurationDefinitionError(
			`Runtime Configuration ${definition.id} default value failed codec validation: ${errorName(error)}`,
		);
	}
	if (!isRuntimeConfigurationJsonObject(defaultValue)) {
		throw invalidRuntimeConfigurationDefinitionError(
			`Runtime Configuration ${definition.id} codec must return a JSON object`,
		);
	}
	const dispose = definition.dispose?.bind(definition);
	return Object.freeze({
		id: definition.id,
		schemaVersion: definition.schemaVersion,
		descriptor: Object.freeze({
			title: definition.descriptor.title,
			...(definition.descriptor.description !== undefined ? { description: definition.descriptor.description } : {}),
			schema: cloneAndFreezeConfigurationObject(definition.descriptor.schema),
			...(definition.descriptor.presentation
				? { presentation: cloneAndFreezeConfigurationObject(definition.descriptor.presentation) }
				: {}),
			...(sensitivePaths.length > 0 ? { sensitivePaths: Object.freeze([...sensitivePaths]) } : {}),
		}),
		codec: Object.freeze({ decode }),
		defaultValue: cloneAndFreezeConfigurationObject(defaultValue),
		apply: definition.apply,
		...(dispose ? { dispose } : {}),
	});
}

function validateSource(source: RuntimeConfigurationSourceRef): RuntimeConfigurationSourceRef {
	if (!source || typeof source !== "object") {
		throw invalidRuntimeConfigurationDefinitionError("Runtime Configuration source must be an object");
	}
	assertNonEmptyId(source.id, "Runtime Configuration source id");
	assertNonEmptyId(source.revision, "Runtime Configuration source revision");
	return Object.freeze({ id: source.id, revision: source.revision });
}

function assertNonEmptyId(value: string, label: string): void {
	if (typeof value !== "string" || value.trim() === "" || value !== value.trim()) {
		throw invalidRuntimeConfigurationDefinitionError(`${label} must be a non-empty trimmed string`);
	}
}

function toEntrySnapshot(entry: RuntimeConfigurationRegistryEntry): RuntimeConfigurationRegistryEntrySnapshot {
	return Object.freeze({
		configurationId: entry.configurationId,
		sourceId: entry.sourceId,
		state: entry.state,
		...(entry.current ? { currentRevisionId: entry.current.revision.id } : {}),
		lastRevisionId: entry.lastRevisionId,
	});
}

function compareEntrySnapshot(
	left: RuntimeConfigurationRegistryEntrySnapshot,
	right: RuntimeConfigurationRegistryEntrySnapshot,
): number {
	return compareString(left.configurationId, right.configurationId);
}

function compareString(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

async function waitUntilUnused(generation: RuntimeConfigurationGeneration): Promise<void> {
	if (generation.activeLeases === 0) return;
	await new Promise<void>((resolve) => generation.unusedWaiters.push(resolve));
}

function configurationIssueCode(error: unknown): RuntimeConfigurationIssueCode {
	return error instanceof RuntimeConfigurationError && error.code === RUNTIME_CONFIGURATION_ERROR_CODES.SOURCE_CONFLICT
		? "definition-source-conflict"
		: "definition-invalid";
}

function safeNonEmptyId(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, 200) : undefined;
}

function errorName(error: unknown): string {
	return error instanceof Error ? error.name : "UnknownError";
}
