import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodingAgentPromptRequestAdapter } from "../../src/adapters/runtime-core/prompt-request-adapter.js";
import { createCodingAgentPromptResourceResolver } from "../../src/resources/prompt-resource-resolver.js";
import { expandPromptResourceReference } from "../../src/resources/prompt-resources/prompt-resource-expander.js";
import type { Skill } from "../../src/resources/skills/index.js";
import { preparePrompt } from "./prompt-adapter-test-fixture.js";

describe("Coding Agent prompt resource resolver", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "astravia-greenfield-resources-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("refreshes and reads the current Skill on every prompt without retaining deleted content", async () => {
		const skillDir = join(root, "review");
		const skillPath = join(skillDir, "SKILL.md");
		mkdirSync(skillDir);
		writeFileSync(skillPath, skillDocument("review", "first instructions"));
		const refreshSkillsIfChanged = vi.fn(async () => true);
		const resourceLoader = {
			refreshSkillsIfChanged,
			getSkills: () => ({
				skills: existsSync(skillPath) ? [createSkill("review", skillDir, skillPath)] : [],
				diagnostics: [],
			}),
		};
		const adapter = new CodingAgentPromptRequestAdapter({
			now: () => 42,
			resolvePromptResource: createCodingAgentPromptResourceResolver({
				resourceLoader,
			}),
		});

		const first = await preparePrompt(
			adapter,
			{ text: "review this", promptRef: { kind: "skill", name: "review" } },
			{ sessionId: "session-1", queueing: false },
		);
		expect(first.input.context?.[0]).toMatchObject({
			type: "skill_expansion",
			content: expect.stringContaining("first instructions"),
		});

		writeFileSync(skillPath, skillDocument("review", "updated instructions"));
		const updated = await preparePrompt(
			adapter,
			{ text: "review again", promptRef: { kind: "skill", name: "review" } },
			{ sessionId: "session-1", queueing: false },
		);
		expect(updated.input.context?.[0]?.content).toEqual(expect.stringContaining("updated instructions"));

		unlinkSync(skillPath);
		const deleted = await preparePrompt(
			adapter,
			{ text: "review once more", promptRef: { kind: "skill", name: "review" } },
			{ sessionId: "session-1", queueing: false },
		);
		expect(deleted.input.context).toEqual([
			{
				type: "prompt_resource_reference",
				content: "",
				modelVisible: false,
				display: false,
				metadata: { promptRef: { kind: "skill", name: "review" } },
			},
		]);
		expect(refreshSkillsIfChanged).toHaveBeenCalledTimes(3);
	});

	it("exposes Skill frontmatter hooks as a prompt-resource contribution", () => {
		const skillDir = join(root, "review");
		const skillPath = join(skillDir, "SKILL.md");
		mkdirSync(skillDir);
		writeFileSync(
			skillPath,
			skillDocument(
				"review",
				"review instructions",
				"hooks:\n  Stop:\n    - hooks:\n        - type: command\n          command: node verify.cjs\n",
			),
		);
		const skill = createSkill("review", skillDir, skillPath);

		const expansion = expandPromptResourceReference(
			"review it",
			{ kind: "skill", name: "review" },
			{
				resourceLoader: {
					getSkills: () => ({ skills: [skill], diagnostics: [] }),
				},
			},
		);

		expect(expansion.promptResourceHookContribution).toMatchObject({
			id: `skill:${skillPath}`,
			sourcePath: skillPath,
			configuration: { Stop: expect.any(Array) },
			env: {
				CLAUDE_PLUGIN_ROOT: skillDir,
				CLAUDE_SKILL_DIR: skillDir,
			},
		});
	});

	it("expands several prompt refs into one skill injection, in selection order", async () => {
		const reviewDir = join(root, "review");
		const auditDir = join(root, "audit");
		mkdirSync(reviewDir);
		mkdirSync(auditDir);
		const reviewPath = join(reviewDir, "SKILL.md");
		const auditPath = join(auditDir, "SKILL.md");
		writeFileSync(reviewPath, skillDocument("review", "review body"));
		writeFileSync(auditPath, skillDocument("audit", "audit body"));
		const adapter = new CodingAgentPromptRequestAdapter({
			now: () => 42,
			resolvePromptResource: createCodingAgentPromptResourceResolver({
				resourceLoader: {
					refreshSkillsIfChanged: async () => false,
					getSkills: () => ({
						skills: [createSkill("review", reviewDir, reviewPath), createSkill("audit", auditDir, auditPath)],
						diagnostics: [],
					}),
				},
			}),
		});

		const prepared = await preparePrompt(
			adapter,
			{
				text: "do both",
				promptRefs: [
					{ kind: "skill", name: "review" },
					{ kind: "skill", name: "audit" },
				],
			},
			{ sessionId: "session-1", queueing: false },
		);

		const expansion = prepared.input.context?.find((record) => record.type === "skill_expansion");
		const content = String(expansion?.content ?? "");
		expect(content).toContain("review body");
		expect(content).toContain("audit body");
		expect(content.indexOf("review body")).toBeLessThan(content.indexOf("audit body"));
		// 历史投影与 metadata 仍按单资源读写：只记首选那个。
		expect(expansion?.metadata).toEqual({ promptRef: { kind: "skill", name: "review" } });
	});

	it("lets promptRef win when a caller sends both promptRef and promptRefs", async () => {
		const reviewDir = join(root, "review");
		const auditDir = join(root, "audit");
		mkdirSync(reviewDir);
		mkdirSync(auditDir);
		const reviewPath = join(reviewDir, "SKILL.md");
		const auditPath = join(auditDir, "SKILL.md");
		writeFileSync(reviewPath, skillDocument("review", "review body"));
		writeFileSync(auditPath, skillDocument("audit", "audit body"));
		const adapter = new CodingAgentPromptRequestAdapter({
			now: () => 42,
			resolvePromptResource: createCodingAgentPromptResourceResolver({
				resourceLoader: {
					refreshSkillsIfChanged: async () => false,
					getSkills: () => ({
						skills: [createSkill("review", reviewDir, reviewPath), createSkill("audit", auditDir, auditPath)],
						diagnostics: [],
					}),
				},
			}),
		});

		const prepared = await preparePrompt(
			adapter,
			{
				text: "do one",
				promptRef: { kind: "skill", name: "review" },
				promptRefs: [{ kind: "skill", name: "audit" }],
			},
			{ sessionId: "session-1", queueing: false },
		);

		const content = prepared.input.context?.find((record) => record.type === "skill_expansion")?.content ?? "";
		expect(content).toContain("review body");
		expect(content).not.toContain("audit body");
	});
});

function createSkill(name: string, baseDir: string, filePath: string): Skill {
	return {
		name,
		description: `${name} description`,
		filePath,
		baseDir,
		source: "test",
		disableModelInvocation: false,
		content: readFileSync(filePath, "utf8"),
	};
}

function skillDocument(name: string, body: string, extraFrontmatter = ""): string {
	return `---\nname: ${name}\ndescription: ${name} description\n${extraFrontmatter}---\n${body}\n`;
}
