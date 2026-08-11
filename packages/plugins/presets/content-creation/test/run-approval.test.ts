import { beforeEach, describe, expect, it } from "vitest";
import {
	clearContentRunApprovals,
	getPendingContentRunIds,
	requestContentRunApproval,
	resolveContentRunApproval,
	subscribeContentRunApprovals,
} from "../src/plugin/run-approval";

describe("content run approval store", () => {
	beforeEach(clearContentRunApprovals);

	it("queues each prepared run once and resolves it outside the conversation", () => {
		let changes = 0;
		const unsubscribe = subscribeContentRunApprovals(() => {
			changes += 1;
		});

		requestContentRunApproval("run-a");
		requestContentRunApproval("run-a");
		requestContentRunApproval("run-b");
		expect(getPendingContentRunIds()).toEqual(["run-a", "run-b"]);

		resolveContentRunApproval("run-a");
		expect(getPendingContentRunIds()).toEqual(["run-b"]);
		expect(changes).toBe(3);
		unsubscribe();
	});
});
