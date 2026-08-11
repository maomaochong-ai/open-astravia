import { getEventListeners } from "node:events";
import { describe, expect, it } from "vitest";
import { createLinkedAbortSignal } from "../src/utils/linked-abort-signal.js";

describe("createLinkedAbortSignal", () => {
	it("removes the parent listener when each request completes", () => {
		const parent = new AbortController();

		for (let index = 0; index < 20; index += 1) {
			const linked = createLinkedAbortSignal(parent.signal);
			expect(getEventListeners(parent.signal, "abort")).toHaveLength(1);
			linked.dispose();
			expect(getEventListeners(parent.signal, "abort")).toHaveLength(0);
		}
	});

	it("forwards the parent abort reason", () => {
		const parent = new AbortController();
		const linked = createLinkedAbortSignal(parent.signal);
		const reason = new Error("cancelled");

		parent.abort(reason);

		expect(linked.signal?.aborted).toBe(true);
		expect(linked.signal?.reason).toBe(reason);
		expect(getEventListeners(parent.signal, "abort")).toHaveLength(0);
		linked.dispose();
	});
});
