import { describe, expect, it, vi } from "vitest";
import { DesktopGoalController } from "./desktop-goal-controller.js";

describe("DesktopGoalController", () => {
	it("creates the goal before continuing the idle session", async () => {
		const order: string[] = [];
		const invokeSessionExtension = vi.fn(async (_sessionId, token) => {
			order.push(token.id);
			return goal("active");
		});
		const runtime = {
			invokeSessionExtension,
			getState: () => ({ isStreaming: false }),
			continue: vi.fn(async () => {
				order.push("continue");
			}),
			abort: vi.fn(async () => undefined),
		};
		const controller = new DesktopGoalController(runtime as never);

		await controller.start("session-1", "Ship");

		expect(order).toEqual(["coding-agent.goal.create", "continue"]);
		expect(invokeSessionExtension).toHaveBeenCalledWith(
			"session-1",
			expect.objectContaining({ id: "coding-agent.goal.create" }),
			{ objective: "Ship" },
		);
	});

	it("pauses state before aborting so a racing natural stop cannot enqueue another continuation", async () => {
		const order: string[] = [];
		const runtime = {
			invokeSessionExtension: vi.fn(async () => {
				order.push("pause");
				return goal("paused");
			}),
			continue: vi.fn(async () => undefined),
			getState: () => ({ isStreaming: true }),
			abort: vi.fn(async () => {
				order.push("abort");
			}),
		};
		const controller = new DesktopGoalController(runtime as never);

		await controller.pause("session-1", "goal-1");

		expect(order).toEqual(["pause", "abort"]);
	});

	it("rolls a failed resume back to paused", async () => {
		const statuses: string[] = [];
		const runtime = {
			invokeSessionExtension: vi.fn(async (_sessionId, _token, input: { status?: string }) => {
				if (input.status) statuses.push(input.status);
				return goal(input.status ?? "active");
			}),
			continue: vi.fn(async () => {
				throw new Error("busy");
			}),
			getState: () => ({ isStreaming: false }),
			abort: vi.fn(async () => undefined),
		};
		const controller = new DesktopGoalController(runtime as never);

		await expect(controller.resume("session-1", "goal-1")).rejects.toThrow("busy");
		expect(statuses).toEqual(["active", "paused"]);
	});
});

function goal(status: string) {
	return {
		goalId: "goal-1",
		objective: "Ship",
		status,
		tokensUsed: 0,
		timeUsedSeconds: 0,
		continuationCount: 0,
		createdAt: "t",
		updatedAt: "t",
	};
}
