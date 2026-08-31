import type {
	RuntimeCapabilityComposition,
	RuntimeSnapshotAcquireContext,
	RuntimeSnapshotLease,
	RuntimeSnapshotProvider,
} from "../kernel/index.js";
import { RetryableCleanup, RetryableCloseController } from "../lifecycle/retryable-cleanup.js";
import { type RuntimeObservationPublisher, runtimeObservationFailure } from "../observation/index.js";
import type { RuntimeResources } from "../runtime-host/composed-runtime-factory.js";
import type { SessionExtensionComposition } from "../session-extensions/index.js";
import type {
	RuntimeAgentInstanceDefinition,
	RuntimeAgentRevisionLease,
	RuntimeAgentSessionPlan,
	RuntimeAgentSnapshotAdmission,
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
import { createRuntimeAgentSessionObservationPublisher } from "./session-observations.js";

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
	private activeSessionPlan: RuntimeAgentSessionPlan;
	private readonly initialExtensionIds: readonly string[];
	private readonly retainedRollouts: RetainedSessionRollout[] = [];
	private rolloutTail: Promise<void> = Promise.resolve();
	private admissionTail: Promise<void> = Promise.resolve();
	private effectiveRevision: string;
	private sessionId: string;
	private runtimeResources?: RuntimeResources;
	private readonly cleanup = new RetryableCleanup();
	private readonly closeController: RetryableCloseController;
	private cleanupPrepared = false;
	private closed = false;

	constructor(private readonly options: RuntimeAgentSessionOptions) {
		this.sessionId = options.id;
		this.instanceId = options.instanceId;
		this.agentId = options.agentId;
		this.effectiveRevision = options.revisionId;
		this.capabilities = options.capabilities;
		this.extensions = options.extensions;
		this.initialSessionPlan = options.sessionPlan;
		this.activeSessionPlan = options.sessionPlan;
		this.initialExtensionIds = runtimeAgentExtensionIds(options.sessionPlan.definition);
		this.closeController = new RetryableCloseController({
			cleanup: async () => {
				await this.rolloutTail;
				await this.admissionTail;
				await this.disposeResources();
			},
			onCompleted: () => this.options.onClosed(this),
		});
	}

	get id(): string {
		return this.sessionId;
	}

	get revisionId(): string {
		return this.effectiveRevision;
	}

	async acquire(context?: RuntimeSnapshotAcquireContext): Promise<RuntimeSnapshotLease> {
		this.assertOpen();
		const operation = this.admissionTail.then(() => this.acquirePreparedSnapshot(context));
		this.admissionTail = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	}

	private async acquirePreparedSnapshot(context?: RuntimeSnapshotAcquireContext): Promise<RuntimeSnapshotLease> {
		this.assertOpen();
		context?.signal.throwIfAborted();
		let admission: RuntimeAgentSnapshotAdmission | undefined;
		let lease: RuntimeSnapshotLease | undefined;
		try {
			admission = (await this.activeSessionPlan.beforeSnapshotAcquire?.(context)) ?? undefined;
			lease = await this.capabilities.acquire(context);
			context?.signal.throwIfAborted();
			this.assertOpen();
			await admission?.commit();
			return lease;
		} catch (error) {
			const failures: unknown[] = [error];
			try {
				await lease?.release();
			} catch (releaseError) {
				failures.push(releaseError);
			}
			try {
				await admission?.rollback(error);
			} catch (rollbackError) {
				failures.push(rollbackError);
			}
			if (failures.length > 1)
				throw new AggregateError(failures, "Agent snapshot admission and rollback failed", { cause: error });
			throw error;
		}
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
			const previewSignal = new AbortController().signal;
			const resources = await this.initialSessionPlan.activate({
				snapshotProvider: this,
				acquirePreviewSnapshot: () =>
					this.acquire({
						sessionId: this.id,
						operationId: `${this.id}:agent-session-preview`,
						reason: "preview",
						signal: previewSignal,
					}),
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

	/** 标准 Session Backend 用于区分完整产品 Plan 与需要宿主资源工厂的简单 Definition。 */
	readRuntimeResources(): RuntimeResources | undefined {
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
		this.rolloutTail = this.admissionTail.then(async () => {
			try {
				resolveResult(await this.applyLatestRevision(signal));
			} catch (error) {
				rejectResult(error);
			}
		});
		this.admissionTail = this.rolloutTail;
		return result;
	}

	close(): Promise<void> {
		this.closed = true;
		return this.closeController.run();
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
		const observations = createRuntimeAgentSessionObservationPublisher(
			this.options.observationPublisher.scope({
				agentId: this.agentId,
				revisionId: revisionLease.revision.id,
				instanceId: this.instanceId,
			}),
			() => this.id,
		);
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
			this.activeSessionPlan = sessionPlan;
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
		this.prepareCleanup();
		const observations = this.options.observationPublisher.scope({
			agentId: this.agentId,
			revisionId: this.effectiveRevision,
			instanceId: this.instanceId,
			sessionId: this.id,
		});
		try {
			await this.cleanup.run("Failed to close Runtime Agent Session");
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
		}
	}

	private prepareCleanup(): void {
		if (this.cleanupPrepared) return;
		this.cleanupPrepared = true;
		let phase = 0;
		this.cleanup.add({ id: "capabilities", phase: phase++, cleanup: () => this.capabilities.close() });
		this.cleanup.add({ id: "extensions", phase: phase++, cleanup: () => this.extensions.dispose() });
		for (const [index, rollout] of this.retainedRollouts.slice().reverse().entries()) {
			this.cleanup.add({
				id: `rollout:${index}:session-plan`,
				phase: phase++,
				cleanup: () => rollout.sessionPlan.dispose?.(),
			});
			this.cleanup.add({
				id: `rollout:${index}:instance-definition`,
				phase: phase++,
				cleanup: () => rollout.instanceDefinition.dispose?.(),
			});
			this.cleanup.add({
				id: `rollout:${index}:revision-lease`,
				phase: phase++,
				cleanup: () => rollout.revisionLease.release(),
			});
		}
		this.cleanup.add({
			id: "initial-session-plan",
			phase,
			cleanup: () => this.initialSessionPlan.dispose?.(),
		});
	}

	private assertOpen(): void {
		if (this.closed) {
			throw new RuntimeAgentError(RUNTIME_AGENT_ERROR_CODES.CLOSED, `Runtime Agent Session is closed: ${this.id}`);
		}
	}
}
