import { describe, expect, it, vi } from "vitest";
import type { RuntimeSessionExecutionObservation, SessionEvent } from "../../src/index.js";
import {
	RuntimeActiveSessionEventRelay,
	type RuntimeActiveSessionListenerKind,
} from "../../src/runtime-host/active-session-event-relay.js";
import type { RuntimeSession } from "../../src/runtime-host/kernel-runtime-session-backend.js";

describe("RuntimeActiveSessionEventRelay", () => {
	it("keeps listeners bound across Session replacement and suppresses transition events", async () => {
		const first = createSessionHarness();
		const second = createSessionHarness();
		const relay = new RuntimeActiveSessionEventRelay(first.session);
		const events: SessionEvent[] = [];
		const observations: RuntimeSessionExecutionObservation[] = [];
		relay.subscribe((event) => events.push(event));
		relay.subscribeExecutionObservations((observation) => {
			observations.push(observation);
		});

		first.emitEvent(sessionEvent("first"));
		await first.emitObservation(executionObservation("first"));
		let replaced = false;
		relay.replaceSession(second.session, () => {
			replaced = true;
		});
		first.emitEvent(sessionEvent("retired"));
		await first.emitObservation(executionObservation("retired"));
		relay.setEventsSuppressed(true);
		second.emitEvent(sessionEvent("suppressed"));
		relay.setEventsSuppressed(false);
		second.emitEvent(sessionEvent("second"));
		await second.emitObservation(executionObservation("second"));

		expect(replaced).toBe(true);
		expect(events.map((event) => event.sessionId)).toEqual(["first", "second"]);
		expect(observations.map((observation) => observation.turnId)).toEqual(["first", "second"]);
		expect(first.releaseEvents).toHaveBeenCalledOnce();
		expect(first.releaseObservations).toHaveBeenCalledOnce();
	});

	it("isolates listener failures and reports their channel", async () => {
		const harness = createSessionHarness();
		const failures: Array<{ kind: RuntimeActiveSessionListenerKind; error: unknown }> = [];
		const relay = new RuntimeActiveSessionEventRelay(harness.session, {
			reportListenerError: (kind, error) => failures.push({ kind, error }),
		});
		const eventListener = vi.fn();
		const observationListener = vi.fn();
		relay.subscribe(() => {
			throw new Error("event failed");
		});
		relay.subscribe(eventListener);
		relay.subscribeExecutionObservations(() => {
			throw new Error("observation failed");
		});
		relay.subscribeExecutionObservations(observationListener);

		harness.emitEvent(sessionEvent("session"));
		await harness.emitObservation(executionObservation("session"));

		expect(eventListener).toHaveBeenCalledOnce();
		expect(observationListener).toHaveBeenCalledOnce();
		expect(failures.map((failure) => failure.kind)).toEqual(["event", "execution-observation"]);
	});
});

function createSessionHarness() {
	let eventListener: ((event: SessionEvent) => void) | undefined;
	let observationListener: ((observation: RuntimeSessionExecutionObservation) => Promise<void> | void) | undefined;
	const releaseEvents = vi.fn(() => {
		eventListener = undefined;
	});
	const releaseObservations = vi.fn(() => {
		observationListener = undefined;
	});
	const session = {
		subscribe(listener: (event: SessionEvent) => void) {
			eventListener = listener;
			return releaseEvents;
		},
		subscribeExecutionObservations(listener: typeof observationListener) {
			observationListener = listener;
			return releaseObservations;
		},
	} as unknown as RuntimeSession;
	return {
		session,
		releaseEvents,
		releaseObservations,
		emitEvent: (event: SessionEvent) => eventListener?.(event),
		emitObservation: async (observation: RuntimeSessionExecutionObservation) => {
			await observationListener?.(observation);
		},
	};
}

function sessionEvent(sessionId: string): SessionEvent {
	return { type: "session.lifecycle", phase: "agent_start", sessionId } as SessionEvent;
}

function executionObservation(sessionId: string): RuntimeSessionExecutionObservation {
	return { turnId: sessionId, event: { type: "agent.start" }, timestamp: 1 };
}
