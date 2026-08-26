import { createRuntimeId } from "../id-generator.js";
import { FeatureCompiler, RandomIdGenerator } from "../kernel/index.js";
import { RetryableCleanup, RetryableCloseController } from "../lifecycle/retryable-cleanup.js";
import {
	createRuntimeObservationPublisher,
	type RuntimeObservationPort,
	type RuntimeObservationPublisher,
	runtimeObservationFailure,
} from "../observation/index.js";
import type { RuntimeAgentInstanceDefinition } from "./contracts.js";
import { normalizeRuntimeAgentInstanceDefinition } from "./definition-validation.js";
import { RUNTIME_AGENT_ERROR_CODES, RuntimeAgentError } from "./errors.js";
import { RuntimeAgentInstance } from "./instance.js";
import {
	cleanupRuntimeAgentResources,
	compareRuntimeAgentId,
	runtimeAgentDuplicateIdError,
	runtimeAgentInstanceNotFoundError,
} from "./lifecycle.js";
import { RUNTIME_AGENT_LIFECYCLE_OBSERVATION } from "./observations.js";
import { RuntimeAgentRegistry } from "./registry.js";
import type {
	RuntimeAgentInstanceCreateOptions,
	RuntimeAgentRuntimeOptions,
	RuntimeAgentRuntimeSnapshot,
	RuntimeAgentSessionCreateOptions,
} from "./runtime-contracts.js";
import type { RuntimeAgentSession } from "./session.js";

export class RuntimeAgentRuntime {
	readonly registry: RuntimeAgentRegistry;
	private readonly ownsRegistry: boolean;
	private readonly createId: (scope: "instance" | "session") => string;
	private readonly createFeatureCompiler: () => FeatureCompiler;
	private readonly observations: RuntimeObservationPublisher;
	private readonly ownsObservationPublisher: boolean;
	private readonly ownedObservationPort: RuntimeObservationPort | undefined;
	private readonly instances = new Map<string, RuntimeAgentInstance>();
	private readonly sessions = new Map<string, RuntimeAgentSession>();
	private readonly cleanup = new RetryableCleanup();
	private readonly closeController: RetryableCloseController;
	private cleanupPrepared = false;
	private closed = false;

	constructor(options: RuntimeAgentRuntimeOptions = {}) {
		if (options.observationPort && options.observationPublisher) {
			throw new Error(
				"Runtime Agent control plane accepts either observationPort or observationPublisher, not both",
			);
		}
		this.observations =
			options.observationPublisher ?? createRuntimeObservationPublisher({ port: options.observationPort });
		this.ownsObservationPublisher = options.observationPublisher === undefined;
		this.ownedObservationPort = options.observationPublisher === undefined ? options.observationPort : undefined;
		this.registry = options.registry ?? new RuntimeAgentRegistry({ observationPublisher: this.observations });
		this.ownsRegistry = options.registry === undefined;
		this.createId = options.createId ?? ((scope) => `${scope}-${createRuntimeId()}`);
		this.createFeatureCompiler =
			options.createFeatureCompiler ?? (() => new FeatureCompiler({ idGenerator: new RandomIdGenerator() }));
		this.closeController = new RetryableCloseController({ cleanup: () => this.disposeResources() });
	}

	async createInstance(options: RuntimeAgentInstanceCreateOptions): Promise<RuntimeAgentInstance> {
		this.assertOpen();
		const instanceId = options.instanceId ?? this.createId("instance");
		if (this.instances.has(instanceId)) throw runtimeAgentDuplicateIdError("Instance", instanceId);
		const signal = options.signal ?? new AbortController().signal;
		const revisionLease = this.registry.acquire(options.agentId);
		const observationPublisher = options.observationPublisher ?? this.observations;
		const observations = observationPublisher.scope({
			agentId: options.agentId,
			revisionId: revisionLease.revision.id,
			instanceId,
		});
		observations.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
			operation: "instance.create",
			phase: "started",
		});
		let definition: RuntimeAgentInstanceDefinition | undefined;
		try {
			definition = normalizeRuntimeAgentInstanceDefinition(
				await revisionLease.revision.definition.createInstance({
					agentId: options.agentId,
					revisionId: revisionLease.revision.id,
					instanceId,
					signal,
					observationPublisher: observations,
					configuration: options.configuration,
				}),
			);
			const instance = new RuntimeAgentInstance({
				id: instanceId,
				agentId: options.agentId,
				revisionLease,
				definition,
				configuration: options.configuration,
				registry: this.registry,
				observationPublisher,
				createId: this.createId,
				createFeatureCompiler: this.createFeatureCompiler,
				onSessionCreated: (session) => {
					if (this.sessions.has(session.id)) throw runtimeAgentDuplicateIdError("Session", session.id);
					this.sessions.set(session.id, session);
				},
				onSessionClosed: (session) => this.sessions.delete(session.id),
				onSessionRebind: (session, nextSessionId) => {
					this.rebindSession(session.id, nextSessionId);
				},
				onClosed: (closedInstance) => this.instances.delete(closedInstance.id),
			});
			this.instances.set(instanceId, instance);
			observations.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
				operation: "instance.create",
				phase: "completed",
			});
			return instance;
		} catch (error) {
			observations.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
				operation: "instance.create",
				phase: "failed",
				failure: runtimeObservationFailure(error, signal),
			});
			await cleanupRuntimeAgentResources(
				[() => definition?.dispose?.(), () => revisionLease.release()],
				error,
				"Runtime Agent Instance initialization and rollback failed",
			);
			throw error;
		}
	}

	async createSession(
		instanceId: string,
		options: RuntimeAgentSessionCreateOptions = {},
	): Promise<RuntimeAgentSession> {
		this.assertOpen();
		const instance = this.instances.get(instanceId);
		if (!instance) throw runtimeAgentInstanceNotFoundError(instanceId);
		if (options.sessionId && this.sessions.has(options.sessionId)) {
			throw runtimeAgentDuplicateIdError("Session", options.sessionId);
		}
		return instance.createSession(options);
	}

	getInstance(instanceId: string): RuntimeAgentInstance | undefined {
		return this.instances.get(instanceId);
	}

	getSession(sessionId: string): RuntimeAgentSession | undefined {
		return this.sessions.get(sessionId);
	}

	requireSession(sessionId: string): RuntimeAgentSession {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new RuntimeAgentError(
				RUNTIME_AGENT_ERROR_CODES.SESSION_NOT_FOUND,
				`Runtime Agent Session is not registered: ${sessionId}`,
			);
		}
		return session;
	}

	/**
	 * 原子更新 Runtime Agent 控制面与 Instance 的 Session 索引。
	 * 用于持久化会话 continuation 改变 canonical session id；能力 revision 与在途 lease 不变。
	 */
	rebindSession(sessionId: string, nextSessionId: string): boolean {
		if (sessionId === nextSessionId) return false;
		let session: RuntimeAgentSession | undefined;
		try {
			this.assertOpen();
			session = this.requireSession(sessionId);
			if (!nextSessionId || nextSessionId.trim() !== nextSessionId) {
				throw new RuntimeAgentError(
					RUNTIME_AGENT_ERROR_CODES.INVALID_INSTANCE,
					"Runtime Agent Session id must be a non-empty trimmed string",
				);
			}
			if (this.sessions.has(nextSessionId)) throw runtimeAgentDuplicateIdError("Session", nextSessionId);
			const instance = this.instances.get(session.instanceId);
			if (!instance) throw runtimeAgentInstanceNotFoundError(session.instanceId);
			if (instance.getSession(sessionId) !== session) {
				throw new RuntimeAgentError(
					RUNTIME_AGENT_ERROR_CODES.SESSION_NOT_FOUND,
					`Runtime Agent Session is not registered on Instance ${instance.id}: ${sessionId}`,
				);
			}
			if (instance.getSession(nextSessionId)) throw runtimeAgentDuplicateIdError("Session", nextSessionId);

			session.rebindId(nextSessionId);
			instance.rebindSession(sessionId, nextSessionId, session);
			this.sessions.delete(sessionId);
			this.sessions.set(nextSessionId, session);
			this.observations.record(
				RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
				{ operation: "session.rebind", phase: "completed" },
				toRuntimeAgentSessionContext(session, nextSessionId),
			);
			return true;
		} catch (error) {
			this.observations.record(
				RUNTIME_AGENT_LIFECYCLE_OBSERVATION,
				{
					operation: "session.rebind",
					phase: "failed",
					failure: runtimeObservationFailure(error),
				},
				session ? toRuntimeAgentSessionContext(session, sessionId) : { sessionId },
			);
			throw error;
		}
	}

	async closeSession(sessionId: string): Promise<boolean> {
		const session = this.sessions.get(sessionId);
		if (!session) return false;
		await session.close();
		return true;
	}

	async closeInstance(instanceId: string): Promise<boolean> {
		const instance = this.instances.get(instanceId);
		if (!instance) return false;
		await instance.close();
		return true;
	}

	snapshot(): RuntimeAgentRuntimeSnapshot {
		return Object.freeze({
			closed: this.closed,
			registry: this.registry.snapshot(),
			instances: Object.freeze(
				[...this.instances.values()]
					.sort((left, right) => compareRuntimeAgentId(left.id, right.id))
					.map((instance) => instance.snapshot()),
			),
		});
	}

	close(): Promise<void> {
		this.closed = true;
		return this.closeController.run();
	}

	private disposeResources(): Promise<void> {
		this.prepareCleanup();
		return this.cleanup.run("Failed to close Runtime Agent control plane");
	}

	private prepareCleanup(): void {
		if (this.cleanupPrepared) return;
		this.cleanupPrepared = true;
		let phase = 0;
		for (const [index, instance] of [...this.instances.values()].reverse().entries()) {
			this.cleanup.add({
				id: `instance:${index}`,
				phase: phase++,
				cleanup: () => instance.close(),
			});
		}
		if (this.ownsRegistry) {
			this.cleanup.add({ id: "registry", phase: phase++, cleanup: () => this.registry.close() });
		}
		if (this.ownsObservationPublisher) {
			this.cleanup.add({ id: "observation-publisher", phase: phase++, cleanup: () => this.observations.flush() });
		}
		if (this.ownedObservationPort?.close) {
			this.cleanup.add({
				id: "observation-port",
				phase,
				cleanup: () => this.ownedObservationPort?.close?.(),
			});
		}
	}

	private assertOpen(): void {
		if (this.closed) {
			throw new RuntimeAgentError(RUNTIME_AGENT_ERROR_CODES.CLOSED, "Runtime Agent control plane is closed");
		}
	}
}

function toRuntimeAgentSessionContext(session: RuntimeAgentSession, sessionId: string) {
	return {
		agentId: session.agentId,
		revisionId: session.revisionId,
		instanceId: session.instanceId,
		sessionId,
	};
}
