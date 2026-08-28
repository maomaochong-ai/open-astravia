import { describe, expect, it } from "vitest";
import {
	codingAgentBinaryContentHint,
	isCodingAgentInstructionMarkdown,
} from "../../src/tool-policy/read-tool-policy.js";

describe("Coding Agent read tool policy", () => {
	it("preserves instruction documents without matching near-miss directories", () => {
		expect(isCodingAgentInstructionMarkdown("C:/workspace/SKILL.md")).toBe(true);
		expect(isCodingAgentInstructionMarkdown("C:/workspace/skills/demo/reference.md")).toBe(true);
		expect(isCodingAgentInstructionMarkdown("C:/workspace/skills-preset/reference.md")).toBe(false);
		expect(isCodingAgentInstructionMarkdown("C:/workspace/skills/demo/data.json")).toBe(false);
	});

	it("keeps binary capability guidance in the Coding Agent layer", () => {
		expect(codingAgentBinaryContentHint(".doc")).toContain('"docx" skill');
		expect(codingAgentBinaryContentHint(".custom")).toContain('"custom" skill');
	});
});
