import type {
	RuntimeCapabilityComposition,
	RuntimeSnapshotAcquireContext,
	RuntimeSnapshotLease,
	RuntimeSnapshotProvider,
} from "../kernel/index.js";
import { type RuntimeObservationPublisher, runtimeObservationFailure } from "../observation/index.js";
import type { RuntimeResources } from "../runtime-host/composed-runtime-factory.js";
import type { SessionExtensionComposition } from "../session-extensions/index.js";
import type {
	RuntimeAgentInstanceDefinition,
	RuntimeAgentRevisionLease,
	RuntimeAgentSessionPlan,
} from "./contracts.js";
import {
	assertSameRuntimeAgentExtensionTopology,
	normalizeRuntimeAgentInstanceDefinition,
	normalizeRuntimeAgentSessionPlan,
	runtimeAgentExtensionIds,
	withRuntimeAgentExtensionFeatures,
	withRuntimeAgentObservationPublisher,
} from "./definition-validation.js";
import { RUNTIME_AGENT_ERROR_CODES, RuntimeAgentError } from "./errors.js";
import { cleanupRuntimeAgentResources } from "./lifecycle.js";
import { RUNTIME_AGENT_LIFECYCLE_OBSERVATION } from "./observations.js";
import type { RuntimeAgentRegistry } from "./registry.js";
import type { RuntimeAgentSessionRolloutResult } from "./runtime-contracts.js";

interface RetainedSessionRollout {
	readonly revisionLease: RuntimeAgentRevisionLease;
	readonly instanceDefinition: RuntimeAgentInstanceDefinition;
	readonly sessionPlan: RuntimeAgentSessionPlan;
}

export interface RuntimeAgentSessionOptions {
	readonly id: string;
	readonly instanceId: string;
	readonly agentId: string;
	readonly revisionId: string;
	readonly instanceConfiguration?: unknown;
	readonly sessionConfiguration?: unknown;
	readonly registry: RuntimeAgentRegistry;
	readonly observationPublisher: RuntimeObservationPublisher;
	readonly capabilities: RuntimeCapabilityComposition;
	readonly extensions: SessionExtensionComposition;
	readonly sessionPlan: RuntimeAgentSessionPlan;
	readonly onClosed: (session: RuntimeAgentSession) => void;
}

export class RuntimeAgentSession implements RuntimeSnapshotProvider {
	readonly instanceId: string;
	readonly agentId: string;
	readonly extensions: SessionExtensionComposition;
	private readonly capabilities: RuntimeCapabilityComposition;
	private readonly initialSessionPlan: RuntimeAgentSessionPlan;
	private readonly initialExtensionIds: readonly string[];
	private readonly retainedRollouts: RetainedSessionRollout[] = [];
	private rolloutTail: Promise<void> = Promise.resolve();
	private effectiveRevision: string;
	private sessionId: string;
	private runtimeResources?: RuntimeResources;
	private closed = false;
	private closePromise?: Promise<void>;

	constructor(private readonly options: RuntimeAgentSessionOptions) {
		this.sessionId = options.id;
		this.instanceId = options.instanceId;
		this.agentId = options.agentId;
		this.effectiveRevision = options.revisionId;
		this.capabilities = options.capabilities;
		this.extensions = options.extensions;
		this.initialSessionPlan = options.sessionPlan;
		this.initialExtensionIds = runtimeAgentExtensionIds(options.sessionPlan.definition);
	}

	get id(): string {
		return this.sessionId;
	}

	get revisionId(): string {
		return this.effectiveRevision;
	}

	acquire(context?: RuntimeSnapshotAcquireContext): Promise<RuntimeSnapshotLease> {
		this.assertOpen();
		return this.capabilities.acquire(context);
	}

	async activate(rebindSession: (sessionId: string) => Promise<void> | void): Promise<RuntimeResources | undefined> {
		this.assertOpen();
		if (!this.initialSessionPlan.activate) return undefined;
		if (this.runtimeResources) {
			throw new RuntimeAgentError(
				RUNTIME_AGENT_ERROR_CODES.INVALID_INSTANCE,
				`Runtime Agent Session is already activated: ${this.id}`,
			);
		}
		try {
			const resources = await this.initialSessionPlan.activate({
				snapshotProvider: this,
				acquirePreviewSnapshot: () => this.acquire(),
				rebindSession: async (sessionId) => {
					await rebindSession(sessionId);
				},
				dispose: () => this.close(),
			});
			this.runtimeResources = resources;
			return resources;
		} catch (error) {
			this.initialSessionPlan.onFailure?.();
			throw error;
		}
	}

	requireRuntimeResources(): RuntimeResources {
		if (!this.runtimeResources) {
			throw new RuntimeAgentError(
				RUNTIME_AGENT_ERROR_CODES.INVALID_INSTANCE,
				`Runtime Agent Session does not provide Runtime resources: ${this.id}`,
			);
		}
		return this.runtimeResources;
	}

	rolloutToLatest(signal: AbortSignal = new AbortController().signal): Promise<RuntimeAgentSessionRolloutResult> {
		this.assertOpen();
		let resolveResult!: (result: RuntimeAgentSessionRolloutResult) => void;
		let rejectResult!: (error: unknown) => void;
		const result = new Promise<RuntimeAgentSessionRolloutResult>((resolve, reject) => {
			resolveResult = resolve;
			rejectResult = reject;
		});
		this.rolloutTail = this.rolloutTail.then(async () => {
			try {
				resolveResult(await this.applyLatestRevision(signal));
			} catch (error) {
				rejectResult(error);
			}
		});
		return result;
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.closed = true;
		this.closePromise = this.rolloutTail.then(() => this.disposeResources());
		return this.closePromise;
	}

	/** 仅由 RuntimeAgentRuntime 在持久化 Session continuation 提交身份时调用。 */
	rebindId(sessionId: string): void {
		this.assertOpen();
		if (!sessionId || sessionId.trim() !== sessionId) {
			throw new RuntimeAgentError(
				RUNTIME_AGENT_ERROR_CODES.INVALID_INSTANCE,
				"Runtime Agent Session id must be a non-empty trimmed string",
			);
		}
		this.sessionId = sessionId;
	}

	private async applyLatestRevision(signal: AbortSignal): Promise<RuntimeAgentSessionRolloutResult> {
		this.assertOpen();
		signal.throwIfAborted();
		const revisionLease = this.options.registry.acquire(this.agentId);
		const observations = this.options.observationPublisher.scope({
			agentId: this.agentId,
			revisionId: revisionLease.revision.id,
			instanceId: this.instanceId,
			sessionId: this.id,
		});
		if (revisionLease.revision.id === this.effectiveRevision) {
			await revisionLease.release();
			observations.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
				operation: "session.rollout",
				phase: "unchanged",
			});
			return Object.freeze({ status: "unchanged", revisionId: this.effectiveRevision });
		}
		observations.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
			operation: "session.rollout",
			phase: "started",
		});

		let instanceDefinition: RuntimeAgentInstanceDefinition | undefined;
		let sessionPlan: RuntimeAgentSessionPlan | undefined;
		try {
			instanceDefinition = normalizeRuntimeAgentInstanceDefinition(
				await revisionLease.revision.definition.createInstance({
					agentId: this.agentId,
					revisionId: revisionLease.revision.id,
					instanceId: this.instanceId,
					signal,
					observationPublisher: observations,
					configuration: this.options.instanceConfiguration,
				}),
			);
			sessionPlan = normalizeRuntimeAgentSessionPlan(
				await instanceDefinition.prepareSession({
					agentId: this.agentId,
					revisionId: revisionLease.revision.id,
					instanceId: this.instanceId,
					sessionId: this.id,
					signal,
					observationPublisher: observations,
					configuration: this.options.sessionConfiguration,
				}),
			);
			if (sessionPlan.activate) {
				throw new RuntimeAgentError(
					RUNTIME_AGENT_ERROR_CODES.INVALID_INSTANCE,
					"Runtime Agent rollout cannot replace activated product Session resources; create a new Instance instead",
				);
			}
			assertSameRuntimeAgentExtensionTopology(
				this.id,
				this.initialExtensionIds,
				runtimeAgentExtensionIds(sessionPlan.definition),
			);
			const definition = withRuntimeAgentObservationPublisher(
				withRuntimeAgentExtensionFeatures(sessionPlan.definition.capabilities, this.extensions.features),
				observations,
			);
			const reconfigured = await this.capabilities.reconfigureBinding(
				{ definition, modelBindingProvider: sessionPlan.definition.modelBindingProvider },
				signal,
			);
			if (reconfigured.status === "superseded") {
				throw new RuntimeAgentError(
					RUNTIME_AGENT_ERROR_CODES.INVALID_INSTANCE,
					`Serialized Runtime Agent Session rollout was superseded: ${this.id}`,
				);
			}
			this.effectiveRevision = revisionLease.revision.id;
			this.retainedRollouts.push({ revisionLease, instanceDefinition, sessionPlan });
			observations.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
				operation: "session.rollout",
				phase: "completed",
			});
			return Object.freeze({
				status: "applied",
				revisionId: this.effectiveRevision,
				snapshotId: reconfigured.snapshotId,
			});
		} catch (error) {
			observations.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
				operation: "session.rollout",
				phase: "failed",
				failure: runtimeObservationFailure(error, signal),
			});
			await cleanupRuntimeAgentResources(
				[() => sessionPlan?.dispose?.(), () => instanceDefinition?.dispose?.(), () => revisionLease.release()],
				error,
				"Runtime Agent Session rollout and rollback failed",
			);
			throw error;
		}
	}

	private async disposeResources(): Promise<void> {
		const observations = this.options.observationPublisher.scope({
			agentId: this.agentId,
			revisionId: this.effectiveRevision,
			instanceId: this.instanceId,
			sessionId: this.id,
		});
		const rolloutTasks = this.retainedRollouts
			.slice()
			.reverse()
			.flatMap((rollout) => [
				() => rollout.sessionPlan.dispose?.(),
				() => rollout.instanceDefinition.dispose?.(),
				() => rollout.revisionLease.release(),
			]);
		try {
			await cleanupRuntimeAgentResources(
				[
					() => this.capabilities.close(),
					() => this.extensions.dispose(),
					...rolloutTasks,
					() => this.initialSessionPlan.dispose?.(),
				],
				undefined,
				"Failed to close Runtime Agent Session",
			);
			observations.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
				operation: "session.close",
				phase: "completed",
			});
		} catch (error) {
			observations.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
				operation: "session.close",
				phase: "failed",
				failure: runtimeObservationFailure(error),
			});
			throw error;
		} finally {
			this.options.onClosed(this);
		}
	}

	private assertOpen(): void {
		if (this.closed) {
			throw new RuntimeAgentError(RUNTIME_AGENT_ERROR_CODES.CLOSED, `Runtime Agent Session is closed: ${this.id}`);
		}
	}
}
