import { describe, expect, it } from "vitest";
import { shouldLogFetchFailure } from "./fetch-diagnostics-policy";

describe("shouldLogFetchFailure", () => {
	it("does not report an expected abort as a network error", () => {
		expect(shouldLogFetchFailure(new DOMException("cancelled", "McpSetupLoginCancelled"))).toBe(false);
		const controller = new AbortController();
		controller.abort(new DOMException("cancelled", "McpSetupLoginCancelled"));
		expect(shouldLogFetchFailure(new DOMException("aborted", "AbortError"), controller.signal)).toBe(false);
	});

	it("keeps real network failures visible", () => {
		expect(shouldLogFetchFailure(new TypeError("fetch failed"))).toBe(true);
		expect(shouldLogFetchFailure(new DOMException("timeout", "AbortError"))).toBe(true);
	});
});
