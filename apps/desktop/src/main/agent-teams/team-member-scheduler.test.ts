import { describe, expect, it, vi } from "vitest";
import { TeamMemberScheduler } from "./team-member-scheduler.js";

describe("TeamMemberScheduler", () => {
	it("serializes one member, isolates other members and releases after errors", async () => {
		const scheduler = new TeamMemberScheduler();
		const started = deferred();
		const finish = deferred();
		const next = vi.fn(async () => "next");
		const first = scheduler.schedule({
			teamSessionId: "team",
			memberId: "a",
			run: async () => {
				started.resolve();
				await finish.promise;
				throw new Error("interrupted");
			},
		});
		const failed = expect(first).rejects.toThrow("interrupted");
		await started.promise;
		const second = scheduler.schedule({ teamSessionId: "team", memberId: "a", run: next });
		await scheduler.schedule({
			teamSessionId: "team",
			memberId: "b",
			run: async () => {
				expect(next).not.toHaveBeenCalled();
				expect(scheduler.hasPending("team")).toBe(true);
			},
		});
		finish.resolve();
		await failed;
		await expect(second).resolves.toBe("next");
		expect(scheduler.hasPending("team")).toBe(false);
	});

	it("cancels a queued turn without interrupting the member currently running", async () => {
		const scheduler = new TeamMemberScheduler();
		const started = deferred();
		const finish = deferred();
		const first = scheduler.schedule({
			teamSessionId: "team",
			memberId: "a",
			run: async () => {
				started.resolve();
				await finish.promise;
			},
		});
		await started.promise;
		const controller = new AbortController();
		const run = vi.fn(async () => undefined);
		const queued = scheduler.schedule({ teamSessionId: "team", memberId: "a", signal: controller.signal, run });
		const rejected = expect(queued).rejects.toThrow("queued cancellation");
		controller.abort(new Error("queued cancellation"));
		await rejected;
		expect(run).not.toHaveBeenCalled();
		expect(scheduler.hasPending("team")).toBe(true);
		finish.resolve();
		await first;
		expect(scheduler.hasPending("team")).toBe(false);
	});

	it("rejects transitive wait cycles and removes wait edges after completion", async () => {
		const scheduler = new TeamMemberScheduler();
		const a = scheduler.schedule({
			teamSessionId: "team",
			memberId: "a",
			run: async () => {
				await scheduler.schedule({
					teamSessionId: "team",
					memberId: "b",
					waitingMemberId: "a",
					run: async () => {
						await scheduler.schedule({
							teamSessionId: "team",
							memberId: "c",
							waitingMemberId: "b",
							run: async () => {
								await expect(
									scheduler.schedule({
										teamSessionId: "team",
										memberId: "a",
										waitingMemberId: "c",
										run: async () => undefined,
									}),
								).rejects.toThrow("circular member wait");
							},
						});
					},
				});
			},
		});
		await a;
		await expect(
			scheduler.schedule({
				teamSessionId: "team",
				memberId: "a",
				waitingMemberId: "b",
				run: async () => "released",
			}),
		).resolves.toBe("released");
		expect(scheduler.hasPending("team")).toBe(false);
	});

	it("keeps same-named members in different teams independent", async () => {
		const scheduler = new TeamMemberScheduler();
		const finish = deferred();
		const first = scheduler.schedule({ teamSessionId: "one", memberId: "a", run: () => finish.promise });
		await scheduler.schedule({
			teamSessionId: "two",
			memberId: "a",
			run: async () => {
				expect(scheduler.hasPending("one")).toBe(true);
			},
		});
		finish.resolve();
		await first;
	});
});

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
