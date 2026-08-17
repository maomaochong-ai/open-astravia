import { describe, expect, it } from "vitest";
import { createCodingAgentEditPathPolicy } from "../../src/tool-policy/path/edit-path-policy.js";
import { createCodingAgentWritePathPolicy } from "../../src/tool-policy/path/write-path-policy.js";

describe("Coding Agent path policies", () => {
	const edit = createCodingAgentEditPathPolicy({
		isProtectedSkillOrScenePath: (path) => path.startsWith("protected:"),
		isKnowledgeWikiPath: (path) => path.startsWith("wiki:"),
	});
	const write = createCodingAgentWritePathPolicy({
		isProtectedSkillOrScenePath: (path) => path.startsWith("protected:"),
		isKnowledgeWikiPath: (path) => path.startsWith("wiki:"),
	});

	it("rejects paths classified as protected Skill or Scene resources", () => {
		const absolutePath = "protected:/skills/example/SKILL.md";
		expect(edit.getRejectionReason(absolutePath)).toContain("inside a skill/scene directory");
		expect(write.getRejectionReason(absolutePath)).toContain("inside a skill/scene directory");
	});

	it("rejects paths classified as managed Knowledge Wiki content", () => {
		const wikiPath = "wiki:/knowledge/page.md";
		expect(edit.getRejectionReason(wikiPath)).toContain("managed exclusively by kb_write_page");
		expect(write.getRejectionReason(wikiPath)).toContain("managed exclusively by the kb_write_page tool");
	});

	it("allows paths that the Host does not classify as protected", () => {
		expect(edit.getRejectionReason("workspace:/src/file.ts")).toBeUndefined();
		expect(write.getRejectionReason("workspace:/src/file.ts")).toBeUndefined();
	});
});
