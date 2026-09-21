import { describe, expect, it, vi } from "vitest";
import { DesktopPlanReviewBroker, normalizePlanReviewResult } from "./plan-review-broker.js";

const request = { requestId: "review-1", sessionId: "session-1", plan: "1. Draft" };

function createBroker() {
	const broker = new DesktopPlanReviewBroker();
	const presenter = { present: vi.fn(), resolved: vi.fn() };
	const detach = broker.setPresenter(presenter);
	return { broker, presenter, detach };
}

describe("DesktopPlanReviewBroker", () => {
	it("keeps a plan pending until the user decides, then reports it resolved", async () => {
		const { broker, presenter } = createBroker();
		const review = broker.handle(request);

		expect(presenter.present).toHaveBeenCalledWith(request);
		expect(broker.listPending()).toEqual([request]);

		broker.respond("review-1", { decision: "approve", plan: "1. Edited" });
		await expect(review).resolves.toEqual({ decision: "approve", plan: "1. Edited" });
		expect(broker.listPending()).toEqual([]);
		expect(presenter.resolved).toHaveBeenCalledWith({ requestId: "review-1", sessionId: "session-1" });

		// 重复应答（双击、迟到的 IPC）不会影响已结束的审批。
		broker.respond("review-1", { decision: "revise", feedback: "late" });
		expect(presenter.resolved).toHaveBeenCalledTimes(1);
	});

	it("treats interruption, renderer loss and a missing review surface as no decision", async () => {
		const { broker, detach } = createBroker();
		const controller = new AbortController();
		const aborted = broker.handle(request, controller.signal);
		controller.abort();
		await expect(aborted).resolves.toEqual({ decision: "cancelled" });

		const orphaned = broker.handle({ ...request, requestId: "review-2" });
		broker.cancelAll();
		await expect(orphaned).resolves.toEqual({ decision: "cancelled" });

		detach();
		expect(broker.isAvailable()).toBe(false);
		await expect(broker.handle({ ...request, requestId: "review-3" })).resolves.toEqual({ decision: "cancelled" });
	});
});

describe("normalizePlanReviewResult", () => {
	it.each([
		[{ decision: "approve" }, { decision: "approve" }],
		[{ decision: "approve", plan: "   " }, { decision: "approve" }],
		[
			{ decision: "revise", feedback: "Step 2", plan: "1. A" },
			{ decision: "revise", feedback: "Step 2", plan: "1. A" },
		],
		[
			{ decision: "revise", feedback: 42 },
			{ decision: "revise", feedback: "" },
		],
		[{ decision: "bypass" }, { decision: "cancelled" }],
		[null, { decision: "cancelled" }],
		["approve", { decision: "cancelled" }],
	])("normalizes %j", (input, expected) => {
		expect(normalizePlanReviewResult(input)).toEqual(expected);
	});
});
