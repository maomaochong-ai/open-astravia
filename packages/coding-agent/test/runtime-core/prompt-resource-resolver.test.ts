import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodingAgentPromptRequestAdapter } from "../../src/adapters/runtime-core/prompt-request-adapter.js";
import { createCodingAgentPromptResourceResolver } from "../../src/resources/prompt-resource-resolver.js";
import type { Skill } from "../../src/resources/skills/index.js";
import { CodingAgentTodoRuntime } from "../../src/work-state/todo-runtime.js";

describe("Coding Agent prompt resource resolver", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "vetta-greenfield-resources-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("refreshes and reads the current Skill on every prompt without retaining deleted content", async () => {
		const skillDir = join(root, "review");
		const skillPath = join(skillDir, "SKILL.md");
		mkdirSync(skillDir);
		writeFileSync(skillPath, skillDocument("review", "first instructions"));
		const skill = createSkill("review", "skill", skillDir, skillPath);
		const refreshSkillsIfChanged = vi.fn(() => true);
		const resourceLoader = {
			refreshSkillsIfChanged,
			getSkills: () => ({
				skills: existsSync(skillPath) ? [skill] : [],
				diagnostics: [],
			}),
		};
		const adapter = new CodingAgentPromptRequestAdapter({
			now: () => 42,
			resolvePromptResource: createCodingAgentPromptResourceResolver({
				resourceLoader,
				todoState: new CodingAgentTodoRuntime(),
			}),
		});

		const first = await adapter.prepare(
			{ text: "review this", promptRef: { kind: "skill", name: "review" } },
			{ sessionId: "session-1", queueing: false },
		);
		expect(first.input.context?.[0]).toMatchObject({
			type: "skill_expansion",
			content: expect.stringContaining("first instructions"),
		});

		writeFileSync(skillPath, skillDocument("review", "updated instructions"));
		const updated = await adapter.prepare(
			{ text: "review again", promptRef: { kind: "skill", name: "review" } },
			{ sessionId: "session-1", queueing: false },
		);
		expect(updated.input.context?.[0]?.content).toEqual(expect.stringContaining("updated instructions"));

		unlinkSync(skillPath);
		const deleted = await adapter.prepare(
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

	it("uses the session work-state port when expanding a Scene", async () => {
		const sceneDir = join(root, "deploy");
		const scenePath = join(sceneDir, "SKILL.md");
		mkdirSync(sceneDir);
		writeFileSync(scenePath, skillDocument("deploy", "deploy instructions", "scene"));
		writeFileSync(join(sceneDir, "tasks.json"), JSON.stringify(["prepare", "publish"]));
		const todoState = new CodingAgentTodoRuntime();
		const adapter = new CodingAgentPromptRequestAdapter({
			resolvePromptResource: createCodingAgentPromptResourceResolver({
				resourceLoader: {
					refreshSkillsIfChanged: () => false,
					getSkills: () => ({
						skills: [createSkill("deploy", "scene", sceneDir, scenePath)],
						diagnostics: [],
					}),
				},
				todoState,
			}),
		});

		const prepared = await adapter.prepare(
			{ text: "ship it", promptRef: { kind: "scene", name: "deploy" } },
			{ sessionId: "session-1", queueing: false },
		);

		expect(prepared.input.context?.[0]).toMatchObject({
			type: "scene_expansion",
			content: expect.stringContaining("deploy instructions"),
		});
		expect(todoState.getAll()).toEqual([
			{ id: 1, content: "prepare", status: "pending" },
			{ id: 2, content: "publish", status: "pending" },
		]);
		expect(todoState.getLockSource()).toBe("scene");
	});
});

function createSkill(name: string, type: Skill["type"], baseDir: string, filePath: string): Skill {
	return {
		name,
		description: `${name} description`,
		filePath,
		baseDir,
		source: "test",
		type,
		disableModelInvocation: false,
	};
}

function skillDocument(name: string, body: string, type?: "scene"): string {
	const metadata = type ? `metadata:\n  type: ${type}\n` : "";
	return `---\nname: ${name}\ndescription: ${name} description\n${metadata}---\n${body}\n`;
}
