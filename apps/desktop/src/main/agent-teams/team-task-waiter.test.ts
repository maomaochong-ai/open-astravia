import type { TeamTaskSnapshot } from "@vetta/agent-team";
import { describe, expect, it } from "vitest";
import { waitForTeamTasks } from "./team-task-waiter.js";

describe("waitForTeamTasks", () => {
	it("cannot miss a state transition between subscribing and the initial read", async () => {
		let state: TeamTaskSnapshot["workItem"]["state"] = "running";
		let listener: (() => void) | undefined;
		const waited = waitForTeamTasks({
			read: () => [task(state)],
			subscribe: (next) => {
				listener = next;
				state = "completed";
				return () => {
					listener = undefined;
				};
			},
			signal: new AbortController().signal,
			timeoutMs: 10_000,
		});
		await expect(waited).resolves.toMatchObject({
			reason: "state-changed",
			tasks: [{ workItem: { state: "completed" } }],
		});
		expect(listener).toBeUndefined();
	});

	it("returns a snapshot on zero timeout without changing task state", async () => {
		const waited = await waitForTeamTasks({
			read: () => [task("running")],
			subscribe: () => () => undefined,
			signal: new AbortController().signal,
			timeoutMs: 0,
		});
		expect(waited).toMatchObject({ reason: "timeout", tasks: [{ workItem: { state: "running" } }] });
	});

	it("removes its listener when the caller stops waiting", async () => {
		const controller = new AbortController();
		let subscribed = 0;
		const waited = waitForTeamTasks({
			read: () => [task("running")],
			subscribe: () => {
				subscribed += 1;
				return () => {
					subscribed -= 1;
				};
			},
			signal: controller.signal,
			timeoutMs: 10_000,
		});
		const rejected = expect(waited).rejects.toThrow("stop waiting");
		controller.abort(new Error("stop waiting"));
		await rejected;
		expect(subscribed).toBe(0);
	});
});

function task(state: TeamTaskSnapshot["workItem"]["state"]): TeamTaskSnapshot {
	return {
		teamTaskId: "task",
		workItem: {
			id: "task",
			requestTurnId: "turn",
			createdByParticipantId: "leader",
			assignedToParticipantId: "member",
			objective: "work",
			contextEntryIds: [],
			state,
			...(state === "completed" ? { resultMessageId: "result" } : {}),
			createdAt: 1,
			updatedAt: 1,
			revision: 0,
		},
	};
}
