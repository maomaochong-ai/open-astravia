import { describe, expect, it } from "vitest";
import {
	collectRunningInteractiveSessionIds,
	IDLE_RESIDENT_SESSION_LIMIT,
	InteractiveSessionResidencyTracker,
	reconcileIdleInteractiveSessions,
	selectIdleSessionsToEvict,
} from "./idle-session-residency.js";

describe("selectIdleSessionsToEvict", () => {
	it("keeps every running session and the most recently used idle sessions", () => {
		expect(
			selectIdleSessionsToEvict(
				[
					{ sessionId: "run-a", lastUsedAt: 1, running: true },
					{ sessionId: "idle-old", lastUsedAt: 2, running: false },
					{ sessionId: "idle-mid", lastUsedAt: 3, running: false },
					{ sessionId: "idle-new", lastUsedAt: 4, running: false },
					{ sessionId: "run-b", lastUsedAt: 5, running: true },
					{ sessionId: "idle-oldest", lastUsedAt: 0, running: false },
				],
				3,
			),
		).toEqual(["idle-oldest"]);
	});

	it("does not evict when idle sessions fit in the warm window", () => {
		expect(
			selectIdleSessionsToEvict(
				[
					{ sessionId: "a", lastUsedAt: 1, running: false },
					{ sessionId: "b", lastUsedAt: 2, running: false },
					{ sessionId: "c", lastUsedAt: 3, running: true },
				],
				3,
			),
		).toEqual([]);
	});

	it("never evicts a running session even when it is the oldest", () => {
		expect(
			selectIdleSessionsToEvict(
				[
					{ sessionId: "ancient-running", lastUsedAt: 0, running: true },
					{ sessionId: "idle-1", lastUsedAt: 10, running: false },
					{ sessionId: "idle-2", lastUsedAt: 11, running: false },
					{ sessionId: "idle-3", lastUsedAt: 12, running: false },
					{ sessionId: "idle-4", lastUsedAt: 13, running: false },
				],
				3,
			),
		).toEqual(["idle-1"]);
	});

	it("uses a stable id order when lastUsedAt ties", () => {
		expect(
			selectIdleSessionsToEvict(
				[
					{ sessionId: "b", lastUsedAt: 1, running: false },
					{ sessionId: "a", lastUsedAt: 1, running: false },
					{ sessionId: "c", lastUsedAt: 1, running: false },
					{ sessionId: "d", lastUsedAt: 1, running: false },
				],
				2,
			),
		).toEqual(["c", "d"]);
	});
});

describe("InteractiveSessionResidencyTracker", () => {
	it("evicts idle sessions beyond the default warm window after later touches", () => {
		const tracker = new InteractiveSessionResidencyTracker();
		tracker.touch("s1", 1);
		tracker.touch("s2", 2);
		tracker.touch("s3", 3);
		tracker.touch("s4", 4);
		tracker.touch("s2", 5);

		expect(tracker.idsToEvict(new Set())).toEqual(["s1"]);
		expect(IDLE_RESIDENT_SESSION_LIMIT).toBe(3);
	});

	it("orders same-tick opens by call order so the newest session stays warm", () => {
		const tracker = new InteractiveSessionResidencyTracker();
		tracker.touch("s1");
		tracker.touch("s2");
		tracker.touch("s3");
		tracker.touch("s4");

		expect(tracker.idsToEvict(new Set())).toEqual(["s1"]);
	});

	it("stops tracking a forgotten session so it cannot be selected again", () => {
		const tracker = new InteractiveSessionResidencyTracker();
		tracker.touch("s1", 1);
		tracker.touch("s2", 2);
		tracker.touch("s3", 3);
		tracker.touch("s4", 4);
		tracker.forget("s1");

		expect(tracker.has("s1")).toBe(false);
		expect(tracker.idsToEvict(new Set())).toEqual([]);
		expect(tracker.trackedIds()).toEqual(["s2", "s3", "s4"]);
	});

	it("does not evict a tracked session that is currently running", () => {
		const tracker = new InteractiveSessionResidencyTracker();
		tracker.touch("old-running", 1);
		tracker.touch("a", 2);
		tracker.touch("b", 3);
		tracker.touch("c", 4);

		expect(tracker.idsToEvict(new Set(["old-running"]))).toEqual([]);
	});
});

describe("reconcileIdleInteractiveSessions user flows", () => {
	it("after opening four idle conversations, only the three most recent stay live", async () => {
		const host = createInteractiveHost(["s1", "s2", "s3", "s4"]);
		for (const sessionId of host.live.keys()) host.tracker.touch(sessionId);

		await reconcileIdleInteractiveSessions({
			tracker: host.tracker,
			runningIds: host.runningIds(),
			dispose: (sessionId) => host.dispose(sessionId),
		});

		expect([...host.live.keys()]).toEqual(["s2", "s3", "s4"]);
		expect(host.tracker.trackedIds()).toEqual(["s2", "s3", "s4"]);
	});

	it("keeps a background-running conversation even if it is the oldest", async () => {
		const host = createInteractiveHost(["old-running", "a", "b", "c", "d"]);
		for (const sessionId of host.live.keys()) host.tracker.touch(sessionId);
		host.running.add("old-running");

		await reconcileIdleInteractiveSessions({
			tracker: host.tracker,
			runningIds: host.runningIds(),
			dispose: (sessionId) => host.dispose(sessionId),
		});

		expect([...host.live.keys()]).toEqual(["old-running", "b", "c", "d"]);
		expect(host.running.has("old-running")).toBe(true);
	});

	it("switching back to an older idle conversation keeps it in the warm window", async () => {
		const host = createInteractiveHost(["s1", "s2", "s3", "s4"]);
		for (const sessionId of host.live.keys()) host.tracker.touch(sessionId);
		host.tracker.touch("s1");

		await reconcileIdleInteractiveSessions({
			tracker: host.tracker,
			runningIds: host.runningIds(),
			dispose: (sessionId) => host.dispose(sessionId),
		});

		expect([...host.live.keys()]).toEqual(["s1", "s3", "s4"]);
	});

	it("does not drop a session from tracking when dispose fails, so a later reconcile can retry", async () => {
		const host = createInteractiveHost(["s1", "s2", "s3", "s4"]);
		for (const sessionId of host.live.keys()) host.tracker.touch(sessionId);
		const errors: string[] = [];

		await reconcileIdleInteractiveSessions({
			tracker: host.tracker,
			runningIds: host.runningIds(),
			dispose: async (sessionId) => {
				if (sessionId === "s1") throw new Error("lock held");
				await host.dispose(sessionId);
			},
			onDisposeError: (sessionId) => errors.push(sessionId),
		});

		expect(errors).toEqual(["s1"]);
		expect(host.tracker.has("s1")).toBe(true);
		expect(host.live.has("s1")).toBe(true);

		await reconcileIdleInteractiveSessions({
			tracker: host.tracker,
			runningIds: host.runningIds(),
			dispose: (sessionId) => host.dispose(sessionId),
		});
		expect(host.live.has("s1")).toBe(false);
		expect(host.tracker.has("s1")).toBe(false);
	});
});

describe("collectRunningInteractiveSessionIds", () => {
	it("marks a tracked session running only when its live path is in the running set", () => {
		expect([
			...collectRunningInteractiveSessionIds(["live", "idle", "missing"], getSessionPath, ["/sessions/live.jsonl"]),
		]).toEqual(["live"]);
	});
});

function getSessionPath(sessionId: string): string | undefined {
	if (sessionId === "missing") return undefined;
	return `/sessions/${sessionId}.jsonl`;
}

function createInteractiveHost(sessionIds: readonly string[]) {
	const live = new Map(sessionIds.map((sessionId) => [sessionId, `/sessions/${sessionId}.jsonl`]));
	const running = new Set<string>();
	const tracker = new InteractiveSessionResidencyTracker();
	return {
		live,
		running,
		tracker,
		runningIds(): Set<string> {
			return collectRunningInteractiveSessionIds(
				tracker.trackedIds(),
				(sessionId) => live.get(sessionId),
				[...running].map((sessionId) => live.get(sessionId)).filter((path): path is string => path !== undefined),
			);
		},
		async dispose(sessionId: string): Promise<void> {
			live.delete(sessionId);
			running.delete(sessionId);
			tracker.forget(sessionId);
		},
	};
}
