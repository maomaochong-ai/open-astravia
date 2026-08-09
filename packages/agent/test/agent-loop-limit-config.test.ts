import { describe, expect, it } from "vitest";
import { assertWithinAgentLoopLimit, DEFAULT_AGENT_LOOP_LIMITS, resolveAgentLoopLimits } from "../src/loop/limits.js";
import type { AgentLoopLimits } from "../src/types.js";

describe("agent loop limit configuration", () => {
	it("uses finite defaults without sharing mutable input", () => {
		expect(resolveAgentLoopLimits(undefined)).toEqual(DEFAULT_AGENT_LOOP_LIMITS);
	});

	it("applies partial overrides and preserves other defaults", () => {
		expect(resolveAgentLoopLimits({ maxModelCalls: 7 })).toEqual({
			...DEFAULT_AGENT_LOOP_LIMITS,
			maxModelCalls: 7,
		});
	});

	it.each([
		["maxModelCalls", 0],
		["maxModelCalls", -1],
		["maxToolCalls", 1.5],
		["contextCheckpointTimeoutMs", Number.MAX_SAFE_INTEGER + 1],
	] satisfies [keyof AgentLoopLimits, number][])("rejects invalid %s=%s", (field, value) => {
		expect(() => resolveAgentLoopLimits({ [field]: value })).toThrow(RangeError);
	});

	it("reports the observed count without failing at the exact limit", () => {
		expect(() => assertWithinAgentLoopLimit("model_calls", 2, 2)).not.toThrow();
		expect(() => assertWithinAgentLoopLimit("model_calls", 3, 2)).toThrowError(
			expect.objectContaining({
				code: "AGENT_LOOP_LIMIT_EXCEEDED",
				kind: "model_calls",
				limit: 2,
				observed: 3,
			}),
		);
	});
});
