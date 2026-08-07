import type { RuntimeSession } from "@vetta/runtime-core";
import { RetryableCleanup } from "@vetta/runtime-core";
import type { CodingAgentActiveSessionEventRelay } from "./active-session-event-relay.js";
import type { CodingAgentPreparedSessionBinding } from "./active-session-transition-contracts.js";

export interface CodingAgentRetiredSessionCleanupOptions {
	readonly previous: RuntimeSession;
	readonly prepared?: CodingAgentPreparedSessionBinding;
	readonly reportError: (error: AggregateError) => void;
}

export interface CodingAgentActiveSessionCleanupOptions {
	readonly waitForTransitions: () => Promise<void>;
	readonly events: CodingAgentActiveSessionEventRelay;
	readonly readActiveSession: () => RuntimeSession;
}

/** Owns retryable cleanup after a Session transition has already committed. */
export class CodingAgentSessionTransitionCleanup {
	private readonly retired = new Map<number, RetryableCleanup>();
	private readonly finalCleanup = new RetryableCleanup();
	private sequence = 0;
	private disposePreparation: Promise<void> | undefined;

	async retire(options: CodingAgentRetiredSessionCleanupOptions): Promise<void> {
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

	async dispose(options: CodingAgentActiveSessionCleanupOptions): Promise<void> {
		this.disposePreparation ??= this.prepareDisposal(options);
		await this.disposePreparation;
		await this.finalCleanup.run("Failed to dispose active session host");
	}

	private async prepareDisposal(options: CodingAgentActiveSessionCleanupOptions): Promise<void> {
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
