import { describe, expect, it } from "vitest";
import { type PendingInteraction, syncPendingInteractions } from "./pending-interaction-sync";

interface Request extends PendingInteraction {
	readonly label: string;
}

function createHarness(snapshot: readonly Request[]) {
	let state: Record<string, Request> = {};
	let emitRequest: (request: Request) => void = () => {};
	let emitResolved: (event: PendingInteraction) => void = () => {};
	let resolveSnapshot: () => void = () => {};
	const errors: unknown[] = [];
	const stop = syncPendingInteractions<Request>(
		{
			onRequest: (handler) => {
				emitRequest = handler;
				return () => {
					emitRequest = () => {};
				};
			},
			onResolved: (handler) => {
				emitResolved = handler;
				return () => {
					emitResolved = () => {};
				};
			},
			listPending: () =>
				new Promise((resolve) => {
					resolveSnapshot = () => resolve(snapshot);
				}),
		},
		(update) => {
			state = update(state);
		},
		(error) => errors.push(error),
	);
	return {
		readState: () => state,
		emitRequest: (request: Request) => emitRequest(request),
		emitResolved: (event: PendingInteraction) => emitResolved(event),
		resolveSnapshot: async () => {
			resolveSnapshot();
			await Promise.resolve();
			await Promise.resolve();
		},
		stop,
		errors,
	};
}

const first: Request = { requestId: "r1", sessionId: "s1", label: "first" };
const second: Request = { requestId: "r2", sessionId: "s2", label: "second" };

describe("syncPendingInteractions", () => {
	it("restores pending requests from the snapshot after a reload", async () => {
		const harness = createHarness([first, second]);
		await harness.resolveSnapshot();
		expect(harness.readState()).toEqual({ s1: first, s2: second });
	});

	it("does not let a stale snapshot resurrect a request resolved while it was loading", async () => {
		const harness = createHarness([first]);
		harness.emitResolved(first);
		harness.emitRequest(second);
		await harness.resolveSnapshot();
		expect(harness.readState()).toEqual({ s2: second });
	});

	it("ignores a resolution for a request that was already replaced in the same session", () => {
		const harness = createHarness([]);
		const replacement: Request = { requestId: "r3", sessionId: "s1", label: "replacement" };
		harness.emitRequest(first);
		harness.emitRequest(replacement);
		harness.emitResolved(first);
		expect(harness.readState()).toEqual({ s1: replacement });
	});

	it("stops applying the snapshot and events once disposed", async () => {
		const harness = createHarness([first]);
		harness.stop();
		harness.emitRequest(second);
		await harness.resolveSnapshot();
		expect(harness.readState()).toEqual({});
	});
});
