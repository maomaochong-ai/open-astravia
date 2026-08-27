import { describe, expect, it, vi } from "vitest";
import type { QueueChangedEvent } from "../../src/contracts.js";
import { RuntimeHostQueueSidecar } from "../../src/runtime-host/runtime-host-queue-sidecar.js";
import type { RuntimeSessionQueueController } from "../../src/runtime-host/session-ports.js";
import type { RuntimeQueueSidecarStore } from "../../src/runtime-host/session-services.js";

describe("RuntimeHostQueueSidecar", () => {
	it("serializes writes for the same normalized Session path", async () => {
		let releaseFirst!: () => void;
		const firstWrite = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const calls: string[] = [];
		const store = createStore({
			write: async (_path, snapshot) => {
				calls.push(String(snapshot));
				if (snapshot === "first") await firstWrite;
			},
		});
		const sidecar = new RuntimeHostQueueSidecar({
			store,
			normalizePath: (path) => path.toLowerCase(),
		});

		sidecar.persist("C:/Session.jsonl", event("first"));
		sidecar.persist("c:/session.jsonl", event("second"));
		await Promise.resolve();
		expect(calls).toEqual(["first"]);

		releaseFirst();
		await vi.waitFor(() => expect(calls).toEqual(["first", "second"]));
	});

	it("removes an empty unpaused queue and reports write failures without rejecting", async () => {
		const failure = new Error("disk unavailable");
		const reportFailure = vi.fn();
		const remove = vi.fn(async () => {
			throw failure;
		});
		const sidecar = new RuntimeHostQueueSidecar({ store: createStore({ remove }), reportFailure });

		sidecar.persist("session.jsonl", event(undefined, true));

		await vi.waitFor(() => expect(reportFailure).toHaveBeenCalledWith(failure, "session"));
	});

	it("restores a valid snapshot and ignores read failures", async () => {
		const restoreQueue = vi.fn();
		const queueController = { restoreQueue } as unknown as RuntimeSessionQueueController;
		const sidecar = new RuntimeHostQueueSidecar({
			store: createStore({ read: async () => ({ entries: ["queued"] }) }),
		});

		await sidecar.restore(queueController, "session.jsonl");
		expect(restoreQueue).toHaveBeenCalledWith({ entries: ["queued"] });

		const failing = new RuntimeHostQueueSidecar({
			store: createStore({ read: async () => Promise.reject(new Error("damaged")) }),
		});
		await expect(failing.restore(queueController, "damaged.jsonl")).resolves.toBeUndefined();
	});
});

function event(snapshot: unknown, empty = false): QueueChangedEvent {
	return {
		type: "queue.changed",
		sessionId: "session",
		paused: false,
		entries: empty ? [] : [{ id: "queued" }],
		snapshot,
	} as unknown as QueueChangedEvent;
}

function createStore(overrides: Partial<RuntimeQueueSidecarStore> = {}): RuntimeQueueSidecarStore {
	return {
		read: async () => undefined,
		write: async () => {},
		remove: async () => {},
		...overrides,
	};
}
