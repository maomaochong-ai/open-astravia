import type { RuntimeActiveSessionEventRelay } from "./active-session-event-relay.js";
import type { RuntimeActiveSession } from "./active-session-host-contracts.js";
import { RetryableCleanup } from "./retryable-cleanup.js";

export interface RuntimePreparedSessionBinding {
	commit(): Promise<void>;
	rollback(): Promise<void>;
	finalize(): Promise<void>;
}

export interface RuntimeRetiredSessionCleanupOptions {
	readonly previous: RuntimeActiveSession;
	readonly prepared?: RuntimePreparedSessionBinding;
	readonly reportError: (error: AggregateError) => void;
}

export interface RuntimeActiveSessionCleanupOptions {
	readonly waitForTransitions: () => Promise<void>;
	readonly events: RuntimeActiveSessionEventRelay;
	readonly readActiveSession: () => RuntimeActiveSession;
}

/** Owns retryable cleanup after an active Session transition has committed. */
export class RuntimeSessionTransitionCleanup {
	private readonly retired = new Map<number, RetryableCleanup>();
	private readonly finalCleanup = new RetryableCleanup();
	private sequence = 0;
	private disposePreparation: Promise<void> | undefined;

	async retire(options: RuntimeRetiredSessionCleanupOptions): Promise<void> {
		const cleanupId = this.sequence++;
		const cleanup = new RetryableCleanup();
		this.retired.set(cleanupId, cleanup);
		const prepared = options.prepared;
		if (prepared) {
			cleanup.add({ id: "finalize", cleanup: () => prepared.finalize() });
		}
		cleanup.add({ id: "previous-session", cleanup: () => options.previous.dispose() });
		try {
			await cleanup.run("Session transition committed, but cleanup failed");
			this.retired.delete(cleanupId);
		} catch (error) {
			options.reportError(
				error instanceof AggregateError
					? error
					: new AggregateError([error], "Session transition committed, but cleanup failed"),
			);
		}
	}

	async dispose(options: RuntimeActiveSessionCleanupOptions): Promise<void> {
		this.disposePreparation ??= this.prepareDisposal(options);
		await this.disposePreparation;
		await this.finalCleanup.run("Failed to dispose active session host");
	}

	private async prepareDisposal(options: RuntimeActiveSessionCleanupOptions): Promise<void> {
		await options.waitForTransitions();
		for (const [cleanupId, retiredCleanup] of this.retired) {
			this.finalCleanup.add({
				id: `retired-transition:${cleanupId}`,
				phase: 0,
				cleanup: async () => {
					await retiredCleanup.run("Failed to dispose retired session resources");
					this.retired.delete(cleanupId);
				},
			});
		}
		this.finalCleanup.add({
			id: "active-event-subscription",
			phase: 1,
			cleanup: () => options.events.releaseEvents(),
		});
		this.finalCleanup.add({
			id: "active-execution-observation-subscription",
			phase: 1,
			cleanup: () => options.events.releaseObservations(),
		});
		options.events.clearListeners();
		const activeSession = options.readActiveSession();
		this.finalCleanup.add({ id: "active-session", phase: 2, cleanup: () => activeSession.dispose() });
	}
}
