import { describe, expect, it } from "vitest";
import type { Skill } from "../../../src/resources/skills/contracts.js";
import { readSkillInvocationDocument } from "../../../src/resources/skills/skill-document.js";

describe("Skill invocation document", () => {
	it("creates a stable portable revision that changes with materialized content", () => {
		const original = skill("---\nname: review\n---\nReview carefully.\n");
		const changed = skill("---\nname: review\n---\nReview very carefully.\n");

		const first = readSkillInvocationDocument(original);
		const repeated = readSkillInvocationDocument({ ...original });
		const next = readSkillInvocationDocument(changed);

		expect(first.revision).toBe(repeated.revision);
		expect(next.revision).not.toBe(first.revision);
		expect(first.body.trim()).toBe("Review carefully.");
	});
});

function skill(content: string): Skill {
	return {
		name: "review",
		description: "Review workflow",
		filePath: "C:/skills/review/SKILL.md",
		baseDir: "C:/skills/review",
		source: "test",
		type: "skill",
		disableModelInvocation: false,
		content,
		sceneTasks: [],
	};
}
