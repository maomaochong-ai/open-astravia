import { describe, expect, it, vi } from "vitest";
import { RuntimeActiveSessionEventRelay } from "../../src/runtime-host/active-session-event-relay.js";
import type { RuntimeSession } from "../../src/runtime-host/kernel-runtime-session-backend.js";
import {
	type RuntimePreparedSessionBinding,
	RuntimeSessionTransitionCleanup,
} from "../../src/runtime-host/session-transition-cleanup.js";

describe("RuntimeSessionTransitionCleanup", () => {
	it("reports committed cleanup failure and retries only unfinished resources on final disposal", async () => {
		const previous = createDisposableSession();
		const active = createDisposableSession();
		const events = new RuntimeActiveSessionEventRelay(active.session);
		const reports: AggregateError[] = [];
		let finalizeAttempts = 0;
		const prepared: RuntimePreparedSessionBinding = {
			commit: vi.fn(async () => undefined),
			rollback: vi.fn(async () => undefined),
			finalize: vi.fn(async () => {
				finalizeAttempts += 1;
				if (finalizeAttempts === 1) throw new Error("finalize failed");
			}),
		};
		const cleanup = new RuntimeSessionTransitionCleanup();

		await cleanup.retire({ previous: previous.session, prepared, reportError: (error) => reports.push(error) });

		expect(reports).toHaveLength(1);
		expect(reports[0]?.message).toBe("Session transition committed, but cleanup failed");
		expect(previous.dispose).toHaveBeenCalledOnce();
		expect(prepared.finalize).toHaveBeenCalledOnce();

		await cleanup.dispose({
			waitForTransitions: async () => undefined,
			events,
			readActiveSession: () => active.session,
		});

		expect(prepared.finalize).toHaveBeenCalledTimes(2);
		expect(previous.dispose).toHaveBeenCalledOnce();
		expect(active.releaseEvents).toHaveBeenCalledOnce();
		expect(active.releaseObservations).toHaveBeenCalledOnce();
		expect(active.dispose).toHaveBeenCalledOnce();
		await expect(
			cleanup.dispose({
				waitForTransitions: async () => undefined,
				events,
				readActiveSession: () => active.session,
			}),
		).resolves.toBeUndefined();
		expect(active.dispose).toHaveBeenCalledOnce();
	});
});

function createDisposableSession() {
	const releaseEvents = vi.fn();
	const releaseObservations = vi.fn();
	const dispose = vi.fn(async () => undefined);
	const session = {
		dispose,
		subscribe() {
			return releaseEvents;
		},
		createCoreAssembly() {
			return {
				executionObservationStream: {
					subscribe() {
						return releaseObservations;
					},
				},
			};
		},
	} as unknown as RuntimeSession;
	return { session, dispose, releaseEvents, releaseObservations };
}
