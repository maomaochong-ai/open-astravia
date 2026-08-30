import { describe, expect, it } from "vitest";
import { formatModelVisibleSkills } from "../../../src/model-context/skill-prompt.js";
import { formatSkillsForPrompt } from "../../../src/resources/skills/prompt.js";
import { INVOKE_SKILL_TOOL_DESCRIPTION } from "../../../src/resources/skills/tool/description.js";

describe("model-visible skill routing", () => {
	it("uses the same visible index contract at both entry points", () => {
		const skills = [
			{
				name: "visible",
				description: 'Use <images> & "videos"',
				type: "skill" as const,
				disableModelInvocation: false,
			},
			{ name: "hidden", description: "private", type: "skill" as const, disableModelInvocation: true },
			{ name: "scene", description: "scene-only", type: "scene" as const, disableModelInvocation: false },
		];
		const prompt = formatSkillsForPrompt(skills);
		expect(formatModelVisibleSkills(skills)).toBe(prompt);
		expect(prompt).toContain("Use &lt;images&gt; &amp; &quot;videos&quot;");
		expect(prompt).not.toContain("private");
		expect(prompt).not.toContain("scene-only");
		expect(formatSkillsForPrompt(skills.slice(1))).toBe("");
	});

	it("exposes task matching and non-authorization boundaries before invocation", () => {
		const prompt = formatModelVisibleSkills([
			{ name: "visible", description: "Media workflow", type: "skill", disableModelInvocation: false },
		]);
		for (const text of [prompt, INVOKE_SKILL_TOOL_DESCRIPTION]) {
			expect(text).toContain("outcome and target resource");
			expect(text).toContain("keyword alone is not a match");
			expect(text).toContain("instructions, not authorization");
			expect(text).toContain("planning, creation, or review");
			expect(text).toContain("without requiring the user to name it or already have a project");
			expect(text).not.toContain("BLOCKING REQUIREMENT");
		}
	});
});
