import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCodingAgentEditPathPolicy } from "../../src/adapters/runtime-tools/edit-path-policy.js";
import { createCodingAgentWritePathPolicy } from "../../src/adapters/runtime-tools/write-path-policy.js";
import { CONFIG_DIR_NAME, getAgentDir, getKnowledgeDir, getSceneDir, getUserSkillsDir } from "../../src/config.js";

describe("Coding Agent Runtime path policies", () => {
	const cwd = join(process.cwd(), "workspace-policy-fixture");
	const edit = createCodingAgentEditPathPolicy(cwd);
	const write = createCodingAgentWritePathPolicy(cwd);

	it.each([
		join(getAgentDir(), "skills", "global", "SKILL.md"),
		join(getUserSkillsDir(), "user", "SKILL.md"),
		join(getSceneDir(), "scene.md"),
		join(cwd, CONFIG_DIR_NAME, "skills", "project", "SKILL.md"),
		join(homedir(), ".agents", "skills", "generic", "SKILL.md"),
		join(cwd, ".agents", "skills", "project", "SKILL.md"),
	])("rejects protected skill or scene path %s", (absolutePath) => {
		expect(edit.getRejectionReason(absolutePath)).toContain("inside a skill/scene directory");
		expect(write.getRejectionReason(absolutePath)).toContain("inside a skill/scene directory");
	});

	it("rejects knowledge wiki output while allowing sibling and ordinary workspace paths", () => {
		const wikiPath = join(getKnowledgeDir(), "wiki", "page.md");
		expect(edit.getRejectionReason(wikiPath)).toContain("managed exclusively by kb_write_page");
		expect(write.getRejectionReason(wikiPath)).toContain("managed exclusively by the kb_write_page tool");
		expect(edit.getRejectionReason(join(getKnowledgeDir(), "wiki-sibling", "page.md"))).toBeUndefined();
		expect(write.getRejectionReason(join(cwd, "src", "file.ts"))).toBeUndefined();
	});

	it("does not reject sibling directories that only share a protected prefix", () => {
		const sibling = `${getUserSkillsDir()}-sibling`;
		expect(edit.getRejectionReason(sibling)).toBeUndefined();
		expect(write.getRejectionReason(sibling)).toBeUndefined();
	});
});
