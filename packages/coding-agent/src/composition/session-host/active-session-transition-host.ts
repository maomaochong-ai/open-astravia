import { join } from "node:path";
import type { SessionEndCause } from "@vetta/ecosystem-adapter";
import type { GreenfieldRuntimeSession, RuntimeSessionExecutionObservation, SessionEvent } from "@vetta/runtime-core";
import { CodingAgentActiveSessionEventRelay } from "./active-session-event-relay.js";
import type {
	CodingAgentActiveSessionHostOptions,
	CodingAgentNewSessionOptions,
	CodingAgentPreparedSessionBinding,
	CodingAgentSessionSeedInitializer,
	CodingAgentSessionTransition,
	CodingAgentSessionTransitionDecision,
	CodingAgentSessionTransitionKind,
} from "./active-session-transition-contracts.js";
import { CodingAgentSessionTransitionCleanup } from "./session-transition-cleanup.js";

export type {
	CodingAgentActiveSessionHostOptions,
	CodingAgentNewSessionOptions,
	CodingAgentPreparedSessionBinding,
	CodingAgentSessionSeedInitializer,
	CodingAgentSessionSeedTarget,
	CodingAgentSessionTransition,
	CodingAgentSessionTransitionDecision,
	CodingAgentSessionTransitionKind,
	CodingAgentSessionTransitionLifecycle,
	CodingAgentSessionTransitionRuntimePort,
} from "./active-session-transition-contracts.js";

/**
 * Owns the active Session identity and serializes new, resume and fork transactions.
 * Event rebinding and committed-resource cleanup are delegated to dedicated collaborators.
 */
export class CodingAgentActiveSessionHost {
	private activeSession: GreenfieldRuntimeSession;
	private readonly events: CodingAgentActiveSessionEventRelay;
	private readonly cleanup = new CodingAgentSessionTransitionCleanup();
	private transitionTail: Promise<void> = Promise.resolve();
	private disposed = false;

	constructor(private readonly options: CodingAgentActiveSessionHostOptions) {
		this.activeSession = options.initialSession;
		this.events = new CodingAgentActiveSessionEventRelay(options.initialSession);
	}

	readSession(): GreenfieldRuntimeSession {
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
		return this.runExclusive(() => waitForIdle(this.activeSession));
	}

	startActiveSessionOperation<T>(operation: (session: GreenfieldRuntimeSession) => Promise<T>): Promise<T> {
		let started: Promise<T> | undefined;
		return this.runExclusive(async () => {
			started = operation(this.activeSession);
		}).then(() => {
			if (!started) throw new Error("Greenfield active session operation did not start");
			return started;
		});
	}

	runActiveSessionMutation<T>(operation: (session: GreenfieldRuntimeSession) => Promise<T>): Promise<T> {
		return this.runExclusive(async () => {
			await waitForIdle(this.activeSession);
			return operation(this.activeSession);
		});
	}

	newSession(options?: CodingAgentNewSessionOptions): Promise<{ cancelled: boolean }> {
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
					: await this.options.runtime.backend.create({
							...this.options.sessionOptions,
							sessionId,
							parentSessionPath: options?.parentSession,
						});
				this.options.runtime.sessionHooks.start(next.sessionId, "clear");
				const targetSessionPath = next.createCoreAssembly().lifecycle.sessionPath;
				await this.commitTransition({ ...transition, next, targetSessionPath }, { deleteTargetOnRollback: true });
				return { cancelled: false };
			});
		});
	}

	switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
		return this.runExclusive(async () => {
			const previous = this.activeSession;
			const previousPath = previous.createCoreAssembly().lifecycle.sessionPath;
			if (previousPath === sessionPath) return { cancelled: false };
			const transition = this.describe("resume", previous, { targetSessionPath: sessionPath });
			if ((await this.prepareTransition(transition)).cancelled) return { cancelled: true };
			await this.interruptActiveTurn(previous, "switch_session");

			return this.withEndedSourceHooks(previous, "switch_session", async () => {
				await this.options.runtime.quiesceSessionBackgroundCommands(previous.sessionId);
				const sessionId = this.options.resolveSessionId(sessionPath);
				if (!sessionId) throw new Error(`Greenfield session path is invalid: ${sessionPath}`);
				const next = await this.options.runtime.backend.resume({
					...this.options.sessionOptions,
					sessionId,
				});
				this.options.runtime.sessionHooks.start(next.sessionId, "resume");
				await this.commitTransition({ ...transition, next });
				return { cancelled: false };
			});
		});
	}

	fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
		return this.runExclusive(async () => {
			const previous = this.activeSession;
			await waitForIdle(previous);
			const transition = this.describe("fork", previous, { entryId });
			const decision = await this.prepareTransition(transition);
			if (decision.cancelled) return { text: "", cancelled: true };

			return this.withEndedSourceHooks(previous, "fork_session", async () => {
				await this.options.runtime.quiesceSessionBackgroundCommands(previous.sessionId);
				const fork = await previous.forkSession(entryId);
				const sessionId = this.options.resolveSessionId(fork.path);
				if (!sessionId) {
					await this.deleteCreatedTarget(fork.path);
					throw new Error(`Greenfield fork path is invalid: ${fork.path}`);
				}
				let next: GreenfieldRuntimeSession | undefined;
				try {
					next = await this.options.runtime.backend.resume({
						...this.options.sessionOptions,
						sessionId,
						parentSessionPath: transition.previousSessionPath,
						parentEntryId: entryId,
					});
					this.options.runtime.sessionHooks.start(next.sessionId, "clear");
					await next.createCoreAssembly().historyController.navigateForEdit(entryId);
					if (decision.skipConversationRestore) {
						await this.options.runtime.preserveSessionExecutionContext(previous.sessionId, sessionId);
					}
				} catch (error) {
					if (next) this.options.runtime.sessionHooks.discard(next.sessionId);
					await next?.dispose().catch(() => undefined);
					await this.deleteCreatedTarget(fork.path);
					throw error;
				}
				if (!next) throw new Error("Greenfield fork did not produce a target session");
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

	private describe(
		kind: CodingAgentSessionTransitionKind,
		previous: GreenfieldRuntimeSession,
		extra: Partial<Pick<CodingAgentSessionTransition, "targetSessionPath" | "entryId">> = {},
	): CodingAgentSessionTransition {
		return {
			kind,
			previous,
			previousSessionPath: previous.createCoreAssembly().lifecycle.sessionPath,
			...extra,
		};
	}

	private async prepareTransition(
		transition: CodingAgentSessionTransition,
	): Promise<CodingAgentSessionTransitionDecision> {
		return (await this.options.lifecycle?.before?.(transition)) ?? { cancelled: false };
	}

	private async commitTransition(
		transition: CodingAgentSessionTransition & { readonly next: GreenfieldRuntimeSession },
		options: { readonly deleteTargetOnRollback?: boolean } = {},
	): Promise<void> {
		const previous = transition.previous;
		const next = transition.next;
		let prepared: CodingAgentPreparedSessionBinding | undefined;
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
		transition: CodingAgentSessionTransition & { readonly next: GreenfieldRuntimeSession },
	): void {
		try {
			if (this.options.onTransitionCleanupError) {
				this.options.onTransitionCleanupError(error, transition);
				return;
			}
			console.warn("[GreenfieldActiveSessionHost] Committed session transition cleanup failed", error);
		} catch (reportError) {
			console.warn(
				"[GreenfieldActiveSessionHost] Failed to report committed session transition cleanup",
				new AggregateError([error, reportError]),
			);
		}
	}

	private async withEndedSourceHooks<T>(
		previous: GreenfieldRuntimeSession,
		cause: SessionEndCause,
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

	private replaceActiveSession(session: GreenfieldRuntimeSession): void {
		this.events.replaceSession(session, () => {
			this.activeSession = session;
		});
	}

	private async interruptActiveTurn(session: GreenfieldRuntimeSession, reason: string): Promise<void> {
		if (!session.readState().isStreaming) return;
		this.events.setEventsSuppressed(true);
		try {
			await session.abort(reason);
			await waitForIdle(session);
		} finally {
			this.events.setEventsSuppressed(false);
		}
	}

	private async createInitializedSession(
		sessionId: string,
		parentSession: string | undefined,
		initializer: CodingAgentSessionSeedInitializer,
	): Promise<GreenfieldRuntimeSession> {
		try {
			await initializer.initializeSeed({
				cwd: this.options.sessionOptions.cwd ?? process.cwd(),
				parentSession,
				targetRootDir: this.options.conversationDir,
				targetSessionId: sessionId,
			});
			return await this.options.runtime.backend.resume({
				...this.options.sessionOptions,
				sessionId,
				parentSessionPath: parentSession,
			});
		} catch (error) {
			await this.deleteCreatedTargetPathForSession(sessionId);
			throw error;
		}
	}

	private async deleteCreatedTargetPathForSession(sessionId: string): Promise<void> {
		const targetPath = join(
			this.options.conversationDir,
			`${Buffer.from(sessionId, "utf8").toString("base64url")}.conversation.jsonl`,
		);
		await this.deleteCreatedTarget(targetPath);
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
		if (this.disposed) throw new Error("Greenfield active session host is disposed");
	}
}

async function waitForIdle(session: GreenfieldRuntimeSession): Promise<void> {
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
