import { describe, expect, it } from "vitest";
import { extractToolUiDetails } from "./chat-service";

describe("exit_plan_mode tool details", () => {
	it("keeps the review decision and the approved plan for the transcript card", () => {
		expect(extractToolUiDetails(undefined, { decision: "approve", plan: "1. Ship" })).toEqual({
			planReview: { decision: "approve", plan: "1. Ship" },
		});
		expect(extractToolUiDetails({ details: { decision: "revise" } }, undefined)).toEqual({
			planReview: { decision: "revise" },
		});
	});

	it("ignores details that are not a plan review", () => {
		expect(extractToolUiDetails(undefined, { decision: "bypass", plan: "1. Ship" })).toBeUndefined();
		expect(extractToolUiDetails(undefined, { plan: "1. Ship" })).toBeUndefined();
	});
});
