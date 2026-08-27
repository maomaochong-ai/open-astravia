import type { SessionEvent } from "../contracts.js";
import { runtimeObservationFailure } from "../observation/index.js";
import { RuntimeActiveSessionEventRelay } from "./active-session-event-relay.js";
import type {
	RuntimeActiveSession,
	RuntimeActiveSessionCreateOptions,
	RuntimeActiveSessionEndCause,
	RuntimeActiveSessionHostOptions,
	RuntimeActiveSessionTransition,
	RuntimeActiveSessionTransitionDecision,
	RuntimeActiveSessionTransitionKind,
	RuntimeNewSessionOptions,
	RuntimeSessionSeedInitializer,
} from "./active-session-host-contracts.js";
import { RUNTIME_ACTIVE_SESSION_HOST_OBSERVATION } from "./observations.js";
import type { RuntimeSessionExecutionObservation } from "./session-ports.js";
import { type RuntimePreparedSessionBinding, RuntimeSessionTransitionCleanup } from "./session-transition-cleanup.js";

/** Owns the active Session identity and serializes new, resume and fork transactions. */
export class RuntimeActiveSessionHost<
	TSessionOptions extends RuntimeActiveSessionCreateOptions = RuntimeActiveSessionCreateOptions,
	TSession extends RuntimeActiveSession = RuntimeActiveSession,
> {
	private activeSession: TSession;
	private readonly events: RuntimeActiveSessionEventRelay;
	private readonly cleanup = new RuntimeSessionTransitionCleanup();
	private transitionTail: Promise<void> = Promise.resolve();
	private disposed = false;

	constructor(private readonly options: RuntimeActiveSessionHostOptions<TSessionOptions, TSession>) {
		this.activeSession = options.initialSession;
		this.events = new RuntimeActiveSessionEventRelay(options.initialSession, {
			reportListenerError: (kind, error) => {
				if (this.options.observationPublisher) {
					this.options.observationPublisher.record(
						RUNTIME_ACTIVE_SESSION_HOST_OBSERVATION,
						{
							operation: "listener.notify",
							phase: "failed",
							component: kind === "event" ? "event-listener" : "execution-observation-listener",
							failure: runtimeObservationFailure(error),
						},
						{ sessionId: this.activeSession.sessionId },
					);
					return;
				}
				const label = kind === "event" ? "Event" : "Execution observation";
				console.warn(`[${this.logLabel}] ${label} listener failed`, error);
			},
		});
	}

	readSession(): TSession {
		this.assertOpen();
		return this.activeSession;
	}

	subscribe(listener: (event: SessionEvent) => void): () => void {
		this.assertOpen();
		return this.events.subscribe(listener);
	}

	subscribeExecutionObservations(
		listener: (observation: RuntimeSessionExecutionObservation) => Promise<void> | void,
	): () => void {
		this.assertOpen();
		return this.events.subscribeExecutionObservations(listener);
	}

	waitForIdle(): Promise<void> {
		return this.runExclusive(() => waitForRuntimeSessionIdle(this.activeSession));
	}

	startActiveSessionOperation<T>(operation: (session: TSession) => Promise<T>): Promise<T> {
		let started: Promise<T> | undefined;
		return this.runExclusive(async () => {
			started = operation(this.activeSession);
		}).then(() => {
			if (!started) throw new Error("Active session operation did not start");
			return started;
		});
	}

	runActiveSessionMutation<T>(operation: (session: TSession) => Promise<T>): Promise<T> {
		return this.runExclusive(async () => {
			await waitForRuntimeSessionIdle(this.activeSession);
			return operation(this.activeSession);
		});
	}

	newSession(options?: RuntimeNewSessionOptions): Promise<{ cancelled: boolean }> {
		return this.runExclusive(async () => {
			const previous = this.activeSession;
			const transition = this.describe("new", previous);
			if ((await this.prepareTransition(transition)).cancelled) return { cancelled: true };
			await this.interruptActiveTurn(previous, "new_session");

			return this.withEndedSourceHooks(previous, "new_session", async () => {
				await this.options.runtime.quiesceSessionBackgroundCommands(previous.sessionId);
				const sessionId = this.options.createSessionId();
				const next = options?.seedInitializer
					? await this.createInitializedSession(sessionId, options.parentSession, options.seedInitializer)
					: await this.options.runtime.sessions.create(
							this.createBackendOptions(sessionId, { parentSessionPath: options?.parentSession }),
						);
				this.options.runtime.sessionHooks.start(next.sessionId, "clear");
				const targetSessionPath = next.sessionPath;
				await this.commitTransition({ ...transition, next, targetSessionPath }, { deleteTargetOnRollback: true });
				return { cancelled: false };
			});
		});
	}

	switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
		return this.runExclusive(async () => {
			const previous = this.activeSession;
			const previousPath = previous.sessionPath;
			if (previousPath === sessionPath) return { cancelled: false };
			const transition = this.describe("resume", previous, { targetSessionPath: sessionPath });
			if ((await this.prepareTransition(transition)).cancelled) return { cancelled: true };
			await this.interruptActiveTurn(previous, "switch_session");

			return this.withEndedSourceHooks(previous, "switch_session", async () => {
				await this.options.runtime.quiesceSessionBackgroundCommands(previous.sessionId);
				const sessionId = this.options.resolveSessionId(sessionPath);
				if (!sessionId) throw new Error(`Session path is invalid: ${sessionPath}`);
				const next = await this.options.runtime.sessions.resume(this.createBackendOptions(sessionId));
				this.options.runtime.sessionHooks.start(next.sessionId, "resume");
				await this.commitTransition({ ...transition, next });
				return { cancelled: false };
			});
		});
	}

	fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
		return this.runExclusive(async () => {
			const previous = this.activeSession;
			await waitForRuntimeSessionIdle(previous);
			const transition = this.describe("fork", previous, { entryId });
			const decision = await this.prepareTransition(transition);
			if (decision.cancelled) return { text: "", cancelled: true };

			return this.withEndedSourceHooks(previous, "fork_session", async () => {
				await this.options.runtime.quiesceSessionBackgroundCommands(previous.sessionId);
				const fork = await previous.forkSession(entryId);
				const sessionId = this.options.resolveSessionId(fork.path);
				if (!sessionId) {
					await this.deleteCreatedTarget(fork.path);
					throw new Error(`Fork path is invalid: ${fork.path}`);
				}
				let next: TSession | undefined;
				try {
					next = await this.options.runtime.sessions.resume(
						this.createBackendOptions(sessionId, {
							parentSessionPath: transition.previousSessionPath,
							parentEntryId: entryId,
						}),
					);
					this.options.runtime.sessionHooks.start(next.sessionId, "clear");
					await next.navigateForEdit(entryId);
					if (decision.skipConversationRestore) {
						await this.options.runtime.preserveSessionExecutionContext(previous.sessionId, sessionId);
					}
				} catch (error) {
					if (next) this.options.runtime.sessionHooks.discard(next.sessionId);
					await next?.dispose().catch(() => undefined);
					await this.deleteCreatedTarget(fork.path);
					throw error;
				}
				if (!next) throw new Error("Fork did not produce a target session");
				await this.commitTransition(
					{ ...transition, next, targetSessionPath: fork.path },
					{ deleteTargetOnRollback: true },
				);
				return { text: fork.text, cancelled: false };
			});
		});
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		await this.cleanup.dispose({
			waitForTransitions: () => this.transitionTail,
			events: this.events,
			readActiveSession: () => this.activeSession,
		});
	}

	private get logLabel(): string {
		return this.options.logLabel ?? "RuntimeActiveSessionHost";
	}

	private describe(
		kind: RuntimeActiveSessionTransitionKind,
		previous: TSession,
		extra: Partial<Pick<RuntimeActiveSessionTransition<TSession>, "targetSessionPath" | "entryId">> = {},
	): RuntimeActiveSessionTransition<TSession> {
		return {
			kind,
			previous,
			previousSessionPath: previous.sessionPath,
			...extra,
		};
	}

	private async prepareTransition(
		transition: RuntimeActiveSessionTransition<TSession>,
	): Promise<RuntimeActiveSessionTransitionDecision> {
		return (await this.options.lifecycle?.before?.(transition)) ?? { cancelled: false };
	}

	private async commitTransition(
		transition: RuntimeActiveSessionTransition<TSession> & { readonly next: TSession },
		options: { readonly deleteTargetOnRollback?: boolean } = {},
	): Promise<void> {
		const previous = transition.previous;
		const next = transition.next;
		let prepared: RuntimePreparedSessionBinding | undefined;
		let activeReplaced = false;
		try {
			prepared = await this.options.lifecycle?.prepare?.(transition);
			this.replaceActiveSession(next);
			activeReplaced = true;
			await prepared?.commit();
			await this.options.lifecycle?.after?.(transition);
		} catch (error) {
			if (activeReplaced) this.replaceActiveSession(previous);
			await prepared?.rollback();
			this.options.runtime.sessionHooks.discard(next.sessionId);
			await next.dispose().catch(() => undefined);
			if (options.deleteTargetOnRollback && transition.targetSessionPath) {
				await this.deleteCreatedTarget(transition.targetSessionPath);
			}
			throw error;
		}

		await this.cleanup.retire({
			previous,
			prepared,
			reportError: (error) => this.reportTransitionCleanupError(error, transition),
		});
	}

	private reportTransitionCleanupError(
		error: AggregateError,
		transition: RuntimeActiveSessionTransition<TSession> & { readonly next: TSession },
	): void {
		this.options.observationPublisher?.record(
			RUNTIME_ACTIVE_SESSION_HOST_OBSERVATION,
			{
				operation: "transition.cleanup",
				phase: "failed",
				component: "retired-session",
				transitionKind: transition.kind,
				failure: runtimeObservationFailure(error),
			},
			{ sessionId: transition.next.sessionId },
		);
		try {
			if (this.options.onTransitionCleanupError) {
				this.options.onTransitionCleanupError(error, transition);
				return;
			}
			if (this.options.observationPublisher) return;
			console.warn(`[${this.logLabel}] Committed session transition cleanup failed`, error);
		} catch (reportError) {
			this.options.observationPublisher?.record(
				RUNTIME_ACTIVE_SESSION_HOST_OBSERVATION,
				{
					operation: "reporter.notify",
					phase: "failed",
					component: "cleanup-reporter",
					transitionKind: transition.kind,
					failure: runtimeObservationFailure(reportError),
				},
				{ sessionId: transition.next.sessionId },
			);
			if (this.options.observationPublisher) return;
			console.warn(
				`[${this.logLabel}] Failed to report committed session transition cleanup`,
				new AggregateError([error, reportError]),
			);
		}
	}

	private async withEndedSourceHooks<T>(
		previous: TSession,
		cause: RuntimeActiveSessionEndCause,
		operation: () => Promise<T>,
	): Promise<T> {
		await this.options.runtime.sessionHooks.end(previous.sessionId, cause);
		try {
			return await operation();
		} catch (error) {
			if (this.activeSession === previous) {
				this.options.runtime.sessionHooks.start(previous.sessionId, "resume");
			}
			throw error;
		}
	}

	private replaceActiveSession(session: TSession): void {
		this.events.replaceSession(session, () => {
			this.activeSession = session;
		});
	}

	private async interruptActiveTurn(
		session: RuntimeActiveSession,
		reason: RuntimeActiveSessionEndCause,
	): Promise<void> {
		if (!session.readState().isStreaming) return;
		this.events.setEventsSuppressed(true);
		try {
			await session.abort(reason);
			await waitForRuntimeSessionIdle(session);
		} finally {
			this.events.setEventsSuppressed(false);
		}
	}

	private async createInitializedSession(
		sessionId: string,
		parentSession: string | undefined,
		initializer: RuntimeSessionSeedInitializer,
	): Promise<TSession> {
		try {
			await initializer.initializeSeed({
				cwd: this.options.sessionOptions.cwd ?? this.options.defaultCwd,
				parentSession,
				targetRootDir: this.options.conversationDir,
				targetSessionId: sessionId,
			});
			return await this.options.runtime.sessions.resume(
				this.createBackendOptions(sessionId, { parentSessionPath: parentSession }),
			);
		} catch (error) {
			await this.deleteCreatedTargetPathForSession(sessionId);
			throw error;
		}
	}

	private createBackendOptions(
		sessionId: string,
		identity: Pick<RuntimeActiveSessionCreateOptions, "parentSessionPath" | "parentEntryId"> = {},
	): TSessionOptions {
		return {
			...this.options.sessionOptions,
			sessionId,
			...identity,
		} as TSessionOptions;
	}

	private async deleteCreatedTargetPathForSession(sessionId: string): Promise<void> {
		await this.deleteCreatedTarget(this.options.resolveSessionPath(sessionId));
	}

	private async deleteCreatedTarget(sessionPath: string): Promise<void> {
		if (await this.options.sessionCatalog.ownsSession(sessionPath)) {
			await this.options.sessionCatalog.deleteSessionArtifacts(sessionPath);
		}
	}

	private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
		this.assertOpen();
		const result = this.transitionTail.then(operation);
		this.transitionTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private assertOpen(): void {
		if (this.disposed) throw new Error("active session host is disposed");
	}
}

export async function waitForRuntimeSessionIdle(session: RuntimeActiveSession): Promise<void> {
	await new Promise<void>((resolve) => {
		let unsubscribe: (() => void) | undefined;
		let settled = false;
		const finish = (): void => {
			if (settled) return;
			settled = true;
			unsubscribe?.();
			resolve();
		};
		unsubscribe = session.subscribe((event) => {
			if (event.type !== "session.lifecycle") return;
			if (event.phase !== "agent_end" && event.phase !== "aborted") return;
			finish();
		});
		if (settled) unsubscribe();
		else if (!session.readState().isStreaming) finish();
	});
}
