import { describe, expect, it } from "vitest";
import { classifyRuntimeFailure, isRetryableRuntimeError } from "../src/utils/retryable-error.js";

describe("runtime failure classification", () => {
	it.each([
		["prompt is too long: 101 tokens > 100 maximum", "input-too-large"],
		["HTTP 429 too many requests", "transient"],
		["ECONNRESET", "transient"],
		["invalid API key", "permanent"],
		["AbortError: cancelled", "aborted"],
	] as const)("classifies %s", (message, expected) => {
		expect(classifyRuntimeFailure(new Error(message))).toBe(expected);
	});

	it("keeps quota exhaustion non-retryable", () => {
		expect(isRetryableRuntimeError("429 insufficient_quota: exceeded your current quota")).toBe(false);
	});
});
