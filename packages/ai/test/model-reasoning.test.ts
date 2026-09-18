import { describe, expect, it } from "vitest";
import { getModelReasoningPreset, resolveModelThinkingLevel } from "../src/reasoning-presets.js";

describe("model reasoning declarations", () => {
	it("uses explicit levels and a valid default without imposing a fixed vocabulary", () => {
		expect(
			getModelReasoningPreset({
				reasoning: true,
				api: "openai-responses",
				reasoningLevels: ["high", "xhigh", "future-effort"],
				defaultReasoningLevel: "xhigh",
			}),
		).toEqual({ levels: ["high", "xhigh", "future-effort"], default: "xhigh" });
		expect(
			getModelReasoningPreset({ reasoning: true, reasoningLevels: ["xhigh"], defaultReasoningLevel: "invalid" })
				?.default,
		).toBe("xhigh");
	});
	it("uses API presets only as choices, never as an execution ceiling", () => {
		expect(
			getModelReasoningPreset({ reasoning: true, api: "openai-responses", reasoningLevels: [] })?.levels,
		).toEqual(["minimal", "low", "medium", "high"]);
		expect(resolveModelThinkingLevel({ reasoning: true }, "xhigh")).toBe("xhigh");
		expect(resolveModelThinkingLevel({ reasoning: true }, "custom-max")).toBe("custom-max");
		expect(getModelReasoningPreset({ reasoning: false, reasoningLevels: ["xhigh"] })).toBeUndefined();
		expect(resolveModelThinkingLevel({ reasoning: false }, "xhigh")).toBe("off");
	});
});
