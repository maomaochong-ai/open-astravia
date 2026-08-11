import type { RuntimeSession, RuntimeSessionExecutionObservation, SessionEvent } from "@vetta/runtime-core";

/** Keeps host-level listeners stable while the active Runtime Session changes. */
export class CodingAgentActiveSessionEventRelay {
	private eventUnsubscribe: (() => void) | undefined;
	private observationUnsubscribe: (() => void) | undefined;
	private readonly listeners = new Set<(event: SessionEvent) => void>();
	private readonly observationListeners = new Set<
		(observation: RuntimeSessionExecutionObservation) => Promise<void> | void
	>();
	private suppressEvents = false;

	constructor(session: RuntimeSession) {
		this.bind(session);
	}

	subscribe(listener: (event: SessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	subscribeExecutionObservations(
		listener: (observation: RuntimeSessionExecutionObservation) => Promise<void> | void,
	): () => void {
		this.observationListeners.add(listener);
		return () => this.observationListeners.delete(listener);
	}

	replaceSession(session: RuntimeSession, replaceActiveSession: () => void): void {
		this.releaseEvents();
		this.releaseObservations();
		replaceActiveSession();
		this.bind(session);
	}

	setEventsSuppressed(suppressed: boolean): void {
		this.suppressEvents = suppressed;
	}

	releaseEvents(): void {
		const unsubscribe = this.eventUnsubscribe;
		if (!unsubscribe) return;
		unsubscribe();
		if (this.eventUnsubscribe === unsubscribe) this.eventUnsubscribe = undefined;
	}

	releaseObservations(): void {
		const unsubscribe = this.observationUnsubscribe;
		if (!unsubscribe) return;
		unsubscribe();
		if (this.observationUnsubscribe === unsubscribe) this.observationUnsubscribe = undefined;
	}

	clearListeners(): void {
		this.listeners.clear();
		this.observationListeners.clear();
	}

	private bind(session: RuntimeSession): void {
		this.eventUnsubscribe = session.subscribe((event) => {
			if (this.suppressEvents) return;
			for (const listener of this.listeners) {
				try {
					listener(event);
				} catch (error) {
					console.warn("[CodingAgentActiveSessionHost] Event listener failed", error);
				}
			}
		});
		this.observationUnsubscribe = session
			.createCoreAssembly()
			.executionObservationStream.subscribe(async (observation) => {
				for (const listener of this.observationListeners) {
					try {
						await listener(observation);
					} catch (error) {
						console.warn("[CodingAgentActiveSessionHost] Execution observation listener failed", error);
					}
				}
			});
	}
}
