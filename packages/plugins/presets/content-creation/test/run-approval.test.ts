import { describe, expect, it } from "vitest";
import { ContentRunApprovalStore } from "../src/plugin/run-approval";

describe("content run approval store", () => {
	it("queues each prepared run once and resolves it outside the conversation", () => {
		const store = new ContentRunApprovalStore();
		let changes = 0;
		const unsubscribe = store.subscribe(() => {
			changes += 1;
		});

		store.request("run-a");
		store.request("run-a");
		store.request("run-b");
		expect(store.getSnapshot()).toEqual(["run-a", "run-b"]);

		store.resolve("run-a");
		expect(store.getSnapshot()).toEqual(["run-b"]);
		expect(changes).toBe(3);
		unsubscribe();
	});
});
