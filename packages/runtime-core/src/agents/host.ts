import { createRuntimeId } from "../id-generator.js";
import { FeatureCompiler, RandomIdGenerator } from "../kernel/index.js";
import {
	createRuntimeObservationPublisher,
	type RuntimeObservationPublisher,
	runtimeObservationFailure,
} from "../observation/index.js";
import type { RuntimeAgentInstanceDefinition } from "./contracts.js";
import { normalizeRuntimeAgentInstanceDefinition } from "./definition-validation.js";
import { RUNTIME_AGENT_HOST_ERROR_CODES, RuntimeAgentHostError } from "./errors.js";
import type {
	RuntimeAgentHostOptions,
	RuntimeAgentHostSnapshot,
	RuntimeAgentInstanceCreateOptions,
	RuntimeAgentSessionCreateOptions,
} from "./host-contracts.js";
import { RuntimeAgentInstance } from "./instance.js";
import {
	cleanupRuntimeAgentResources,
	compareRuntimeAgentId,
	runtimeAgentDuplicateIdError,
	runtimeAgentInstanceNotFoundError,
} from "./lifecycle.js";
import { RUNTIME_AGENT_LIFECYCLE_OBSERVATION } from "./observations.js";
import { RuntimeAgentRegistry } from "./registry.js";
import type { RuntimeAgentSession } from "./session.js";

export class RuntimeAgentHost {
	readonly registry: RuntimeAgentRegistry;
	private readonly ownsRegistry: boolean;
	private readonly createId: (scope: "instance" | "session") => string;
	private readonly createFeatureCompiler: () => FeatureCompiler;
	private readonly observations: RuntimeObservationPublisher;
	private readonly instances = new Map<string, RuntimeAgentInstance>();
	private readonly sessions = new Map<string, RuntimeAgentSession>();
	private closed = false;
	private closePromise?: Promise<void>;

	constructor(options: RuntimeAgentHostOptions = {}) {
		this.observations = createRuntimeObservationPublisher({ port: options.observationPort });
		this.registry = options.registry ?? new RuntimeAgentRegistry({ observationPublisher: this.observations });
		this.ownsRegistry = options.registry === undefined;
		this.createId = options.createId ?? ((scope) => `${scope}-${createRuntimeId()}`);
		this.createFeatureCompiler =
			options.createFeatureCompiler ?? (() => new FeatureCompiler({ idGenerator: new RandomIdGenerator() }));
	}

	async createInstance(options: RuntimeAgentInstanceCreateOptions): Promise<RuntimeAgentInstance> {
		this.assertOpen();
		const instanceId = options.instanceId ?? this.createId("instance");
		if (this.instances.has(instanceId)) throw runtimeAgentDuplicateIdError("Instance", instanceId);
		const signal = options.signal ?? new AbortController().signal;
		const revisionLease = this.registry.acquire(options.agentId);
		const observations = this.observations.scope({
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
				observationPublisher: this.observations,
				createId: this.createId,
				createFeatureCompiler: this.createFeatureCompiler,
				onSessionCreated: (session) => {
					if (this.sessions.has(session.id)) throw runtimeAgentDuplicateIdError("Session", session.id);
					this.sessions.set(session.id, session);
				},
				onSessionClosed: (session) => this.sessions.delete(session.id),
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
			throw new RuntimeAgentHostError(
				RUNTIME_AGENT_HOST_ERROR_CODES.SESSION_NOT_FOUND,
				`Runtime Agent Session is not registered: ${sessionId}`,
			);
		}
		return session;
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

	snapshot(): RuntimeAgentHostSnapshot {
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
		if (this.closePromise) return this.closePromise;
		this.closed = true;
		const instances = [...this.instances.values()].reverse();
		this.closePromise = cleanupRuntimeAgentResources(
			[
				...instances.map((instance) => () => instance.close()),
				...(this.ownsRegistry ? [() => this.registry.close()] : []),
				() => this.observations.flush(),
			],
			undefined,
			"Failed to close Runtime Agent Host",
		);
		return this.closePromise;
	}

	private assertOpen(): void {
		if (this.closed) {
			throw new RuntimeAgentHostError(RUNTIME_AGENT_HOST_ERROR_CODES.CLOSED, "Runtime Agent Host is closed");
		}
	}
}
