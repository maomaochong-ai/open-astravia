import { type FeatureCompiler, RuntimeCapabilityComposition } from "../kernel/index.js";
import { type RuntimeObservationPublisher, runtimeObservationFailure } from "../observation/index.js";
import { SessionExtensionComposition } from "../session-extensions/index.js";
import type {
	RuntimeAgentInstanceDefinition,
	RuntimeAgentRevisionLease,
	RuntimeAgentSessionPlan,
} from "./contracts.js";
import {
	normalizeRuntimeAgentSessionPlan,
	withRuntimeAgentExtensionFeatures,
	withRuntimeAgentObservationPublisher,
} from "./definition-validation.js";
import { RUNTIME_AGENT_ERROR_CODES, RuntimeAgentError } from "./errors.js";
import { cleanupRuntimeAgentResources, compareRuntimeAgentId, runtimeAgentDuplicateIdError } from "./lifecycle.js";
import { RUNTIME_AGENT_LIFECYCLE_OBSERVATION } from "./observations.js";
import type { RuntimeAgentRegistry } from "./registry.js";
import type { RuntimeAgentInstanceSnapshot, RuntimeAgentSessionCreateOptions } from "./runtime-contracts.js";
import { RuntimeAgentSession } from "./session.js";

export interface RuntimeAgentInstanceOptions {
	readonly id: string;
	readonly agentId: string;
	readonly revisionLease: RuntimeAgentRevisionLease;
	readonly definition: RuntimeAgentInstanceDefinition;
	readonly configuration?: unknown;
	readonly registry: RuntimeAgentRegistry;
	readonly observationPublisher: RuntimeObservationPublisher;
	readonly createId: (scope: "instance" | "session") => string;
	readonly createFeatureCompiler: () => FeatureCompiler;
	readonly onSessionCreated: (session: RuntimeAgentSession) => void;
	readonly onSessionClosed: (session: RuntimeAgentSession) => void;
	readonly onSessionRebind: (session: RuntimeAgentSession, sessionId: string) => Promise<void> | void;
	readonly onClosed: (instance: RuntimeAgentInstance) => void;
}

export class RuntimeAgentInstance {
	readonly id: string;
	readonly agentId: string;
	readonly revisionId: string;
	private readonly sessions = new Map<string, RuntimeAgentSession>();
	private closed = false;
	private closePromise?: Promise<void>;

	constructor(private readonly options: RuntimeAgentInstanceOptions) {
		this.id = options.id;
		this.agentId = options.agentId;
		this.revisionId = options.revisionLease.revision.id;
	}

	async createSession(options: RuntimeAgentSessionCreateOptions = {}): Promise<RuntimeAgentSession> {
		this.assertOpen();
		const sessionId = options.sessionId ?? this.options.createId("session");
		if (this.sessions.has(sessionId)) throw runtimeAgentDuplicateIdError("Session", sessionId);
		const signal = options.signal ?? new AbortController().signal;
		const observations = this.options.observationPublisher.scope({
			agentId: this.agentId,
			revisionId: this.revisionId,
			instanceId: this.id,
			sessionId,
		});
		observations.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
			operation: "session.create",
			phase: "started",
		});
		let sessionPlan: RuntimeAgentSessionPlan | undefined;
		let extensions: SessionExtensionComposition | undefined;
		let capabilities: RuntimeCapabilityComposition | undefined;
		let session: RuntimeAgentSession | undefined;
		try {
			sessionPlan = normalizeRuntimeAgentSessionPlan(
				await this.options.definition.prepareSession({
					agentId: this.agentId,
					revisionId: this.revisionId,
					instanceId: this.id,
					sessionId,
					signal,
					observationPublisher: observations,
					configuration: options.configuration,
				}),
			);
			extensions = await SessionExtensionComposition.create({
				definitions: sessionPlan.definition.sessionExtensions ?? [],
				signal,
			});
			const capabilityDefinition = withRuntimeAgentObservationPublisher(
				withRuntimeAgentExtensionFeatures(sessionPlan.definition.capabilities, extensions.features),
				observations,
			);
			capabilities = await RuntimeCapabilityComposition.create({
				initialDefinition: capabilityDefinition,
				compiler: this.options.createFeatureCompiler(),
				modelBindingProvider: sessionPlan.definition.modelBindingProvider,
				signal,
			});
			session = new RuntimeAgentSession({
				id: sessionId,
				instanceId: this.id,
				agentId: this.agentId,
				revisionId: this.revisionId,
				instanceConfiguration: this.options.configuration,
				sessionConfiguration: options.configuration,
				registry: this.options.registry,
				observationPublisher: this.options.observationPublisher,
				capabilities,
				extensions,
				sessionPlan,
				onClosed: (closedSession) => {
					this.sessions.delete(closedSession.id);
					this.options.onSessionClosed(closedSession);
				},
			});
			const createdSession = session;
			await createdSession.activate((nextSessionId) => this.options.onSessionRebind(createdSession, nextSessionId));
			this.options.onSessionCreated(session);
			this.sessions.set(sessionId, session);
			observations.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
				operation: "session.create",
				phase: "completed",
			});
			return session;
		} catch (error) {
			observations.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
				operation: "session.create",
				phase: "failed",
				failure: runtimeObservationFailure(error, signal),
			});
			await cleanupRuntimeAgentResources(
				session
					? [() => session?.close()]
					: [() => capabilities?.close(), () => extensions?.dispose(), () => sessionPlan?.dispose?.()],
				error,
				"Runtime Agent Session initialization and rollback failed",
			);
			throw error;
		}
	}

	getSession(sessionId: string): RuntimeAgentSession | undefined {
		return this.sessions.get(sessionId);
	}

	/** 由 Host 在完成全局冲突检查后同步更新 Instance 局部索引。 */
	rebindSession(previousSessionId: string, nextSessionId: string, session: RuntimeAgentSession): void {
		if (previousSessionId === nextSessionId) return;
		if (this.sessions.get(previousSessionId) !== session) {
			throw new RuntimeAgentError(
				RUNTIME_AGENT_ERROR_CODES.SESSION_NOT_FOUND,
				`Runtime Agent Session is not registered on Instance ${this.id}: ${previousSessionId}`,
			);
		}
		if (this.sessions.has(nextSessionId)) throw runtimeAgentDuplicateIdError("Session", nextSessionId);
		this.sessions.delete(previousSessionId);
		this.sessions.set(nextSessionId, session);
	}

	snapshot(): RuntimeAgentInstanceSnapshot {
		return Object.freeze({
			id: this.id,
			agentId: this.agentId,
			revisionId: this.revisionId,
			sessionIds: Object.freeze([...this.sessions.keys()].sort(compareRuntimeAgentId)),
		});
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.closed = true;
		this.closePromise = this.disposeResources();
		return this.closePromise;
	}

	private async disposeResources(): Promise<void> {
		const sessions = [...this.sessions.values()].reverse();
		const observations = this.options.observationPublisher.scope({
			agentId: this.agentId,
			revisionId: this.revisionId,
			instanceId: this.id,
		});
		try {
			await cleanupRuntimeAgentResources(
				[
					...sessions.map((session) => () => session.close()),
					() => this.options.definition.dispose?.(),
					() => this.options.revisionLease.release(),
				],
				undefined,
				"Failed to close Runtime Agent Instance",
			);
			observations.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
				operation: "instance.close",
				phase: "completed",
			});
		} catch (error) {
			observations.record(RUNTIME_AGENT_LIFECYCLE_OBSERVATION, {
				operation: "instance.close",
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
			throw new RuntimeAgentError(RUNTIME_AGENT_ERROR_CODES.CLOSED, `Runtime Agent Instance is closed: ${this.id}`);
		}
	}
}
