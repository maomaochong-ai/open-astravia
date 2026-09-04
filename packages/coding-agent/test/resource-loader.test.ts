import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeResourceAccess } from "@vetta/runtime-node/host";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_DIR_NAME } from "../src/config.js";
import { ExtensionRunner } from "../src/extensions/index.js";
import { createCodingAgentModelRuntime } from "../src/models/index.js";
import type { Skill } from "../src/resources/skills/index.js";
import { SettingsRuntime } from "../src/settings/index.js";
import { createExtensionSessionView } from "./fixtures/extension-session-view.js";
import { createFileAuthStorage } from "./fixtures/file-auth-storage.js";
import { createTestSessionResourceRuntime as createCodingAgentSessionResourceRuntime } from "./fixtures/node-resource-runtime.js";

describe("SessionResourceRuntime", () => {
	let tempDir: string;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `rl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		cwd = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("reload", () => {
		it("should initialize with empty results before reload", () => {
			const loader = createCodingAgentSessionResourceRuntime({ cwd, agentDir });

			expect(loader.getExtensions().extensions).toEqual([]);
			expect(loader.getSkills().skills).toEqual([]);
			expect(loader.getPrompts().prompts).toEqual([]);
			expect(loader.getThemes().themes).toEqual([]);
		});

		it("should preserve the session event bus across reloads", async () => {
			const eventBuses: unknown[] = [];
			const loader = createCodingAgentSessionResourceRuntime({
				cwd,
				agentDir,
				extensionFactories: [
					(api) => {
						eventBuses.push(api.events);
					},
				],
			});

			await loader.reload();
			await loader.reload();

			expect(eventBuses).toHaveLength(2);
			expect(eventBuses[1]).toBe(eventBuses[0]);
		});

		it("should discover skills from agentDir", async () => {
			const skillsDir = join(agentDir, "skills");
			mkdirSync(skillsDir, { recursive: true });
			writeFileSync(
				join(skillsDir, "test-skill.md"),
				`---
name: test-skill
description: A test skill
---
Skill content here.`,
			);

			const loader = createCodingAgentSessionResourceRuntime({ cwd, agentDir });
			await loader.reload();

			const { skills } = loader.getSkills();
			expect(skills.some((s) => s.name === "test-skill")).toBe(true);
		});

		it("logs only aggregate skill loading diagnostics", async () => {
			const skillsDir = join(agentDir, "skills", "private-skill-name");
			mkdirSync(skillsDir, { recursive: true });
			writeFileSync(
				join(skillsDir, "SKILL.md"),
				"---\nname: private-skill-name\ndescription: A private skill\n---\nSkill content.",
			);
			const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

			try {
				const loader = createCodingAgentSessionResourceRuntime({ cwd, agentDir });
				await loader.reload();
				const entry = info.mock.calls.find(([message]) => message === "[skills] loaded");

				expect(entry?.[1]).toEqual(
					expect.objectContaining({
						includeAgentSkills: true,
						total: expect.any(Number),
						diagnosticCount: expect.any(Number),
						bySource: expect.any(Object),
					}),
				);
				expect(entry?.[1]).not.toHaveProperty("cwd");
				expect(entry?.[1]).not.toHaveProperty("names");
				expect(JSON.stringify(entry?.[1])).not.toContain("private-skill-name");
				expect(JSON.stringify(entry?.[1])).not.toContain(tempDir);
			} finally {
				info.mockRestore();
			}
		});

		it("loads initial runtime Skill paths in the first scan and treats reapplying them as a no-op", async () => {
			const runtimeSkillDir = join(tempDir, "plugin-skill");
			mkdirSync(runtimeSkillDir, { recursive: true });
			writeFileSync(
				join(runtimeSkillDir, "SKILL.md"),
				"---\nname: plugin-skill\ndescription: Plugin workflow\n---\nPlugin instructions.",
			);
			let loadCount = 0;
			const loader = createCodingAgentSessionResourceRuntime({
				cwd,
				agentDir,
				includeAgentSkills: false,
				noSkills: true,
				runtimeSkillPaths: [runtimeSkillDir],
				skillsOverride: (result) => {
					loadCount += 1;
					return result;
				},
			});

			await loader.reload();
			expect(loader.getSkills().skills.map((skill) => skill.name)).toContain("plugin-skill");
			expect(loadCount).toBe(1);

			await loader.setRuntimeSkillPaths([runtimeSkillDir]);
			expect(loadCount).toBe(1);
		});

		it("should refresh a project skill directory created after session initialization", async () => {
			const loader = createCodingAgentSessionResourceRuntime({ cwd, agentDir });
			await loader.reload();
			const skillDirectory = join(cwd, CONFIG_DIR_NAME, "skills", "dynamic-project-skill");
			const skillPath = join(skillDirectory, "SKILL.md");

			expect(await loader.refreshSkillsIfChanged()).toBe(false);
			mkdirSync(skillDirectory, { recursive: true });
			writeFileSync(
				skillPath,
				"---\nname: dynamic-project-skill\ndescription: Dynamic version one\n---\nVersion one",
			);
			expect(await loader.refreshSkillsIfChanged()).toBe(true);
			expect(loader.getSkills().skills.find((skill) => skill.name === "dynamic-project-skill")?.description).toBe(
				"Dynamic version one",
			);

			writeFileSync(
				skillPath,
				"---\nname: dynamic-project-skill\ndescription: Dynamic version two changed\n---\nVersion two changed",
			);
			expect(await loader.refreshSkillsIfChanged()).toBe(true);
			expect(loader.getSkills().skills.find((skill) => skill.name === "dynamic-project-skill")?.description).toBe(
				"Dynamic version two changed",
			);

			rmSync(skillDirectory, { recursive: true, force: true });
			expect(await loader.refreshSkillsIfChanged()).toBe(true);
			expect(loader.getSkills().skills.some((skill) => skill.name === "dynamic-project-skill")).toBe(false);
		});

		it("should ignore extra markdown files in auto-discovered skill dirs", async () => {
			const skillDir = join(agentDir, "skills", "pi-skills", "browser-tools");
			mkdirSync(skillDir, { recursive: true });
			writeFileSync(
				join(skillDir, "SKILL.md"),
				`---
name: browser-tools
description: Browser tools
---
Skill content here.`,
			);
			writeFileSync(join(skillDir, "EFFICIENCY.md"), "No frontmatter here");

			const loader = createCodingAgentSessionResourceRuntime({ cwd, agentDir });
			await loader.reload();

			const { skills, diagnostics } = loader.getSkills();
			expect(skills.some((s) => s.name === "browser-tools")).toBe(true);
			expect(diagnostics.some((d) => d.path?.endsWith("EFFICIENCY.md"))).toBe(false);
		});

		it("should discover prompts from agentDir", async () => {
			const promptsDir = join(agentDir, "prompts");
			mkdirSync(promptsDir, { recursive: true });
			writeFileSync(
				join(promptsDir, "test-prompt.md"),
				`---
description: A test prompt
---
Prompt content.`,
			);

			const loader = createCodingAgentSessionResourceRuntime({ cwd, agentDir });
			await loader.reload();

			const { prompts } = loader.getPrompts();
			expect(prompts.some((p) => p.name === "test-prompt")).toBe(true);
		});

		it("should prefer project resources over user on name collisions", async () => {
			const userPromptsDir = join(agentDir, "prompts");
			const projectPromptsDir = join(cwd, CONFIG_DIR_NAME, "prompts");
			mkdirSync(userPromptsDir, { recursive: true });
			mkdirSync(projectPromptsDir, { recursive: true });
			const userPromptPath = join(userPromptsDir, "commit.md");
			const projectPromptPath = join(projectPromptsDir, "commit.md");
			writeFileSync(userPromptPath, "User prompt");
			writeFileSync(projectPromptPath, "Project prompt");

			const userSkillDir = join(agentDir, "skills", "collision-skill");
			const projectSkillDir = join(cwd, CONFIG_DIR_NAME, "skills", "collision-skill");
			mkdirSync(userSkillDir, { recursive: true });
			mkdirSync(projectSkillDir, { recursive: true });
			const userSkillPath = join(userSkillDir, "SKILL.md");
			const projectSkillPath = join(projectSkillDir, "SKILL.md");
			writeFileSync(
				userSkillPath,
				`---
name: collision-skill
description: user
---
User skill`,
			);
			writeFileSync(
				projectSkillPath,
				`---
name: collision-skill
description: project
---
Project skill`,
			);

			const baseTheme = JSON.parse(
				readFileSync(fileURLToPath(new URL("../src/modes/interactive/theme/dark.json", import.meta.url)), "utf-8"),
			) as { name: string; vars?: Record<string, string> };
			baseTheme.name = "collision-theme";
			const userThemePath = join(agentDir, "themes", "collision.json");
			const projectThemePath = join(cwd, CONFIG_DIR_NAME, "themes", "collision.json");
			mkdirSync(join(agentDir, "themes"), { recursive: true });
			mkdirSync(join(cwd, CONFIG_DIR_NAME, "themes"), { recursive: true });
			writeFileSync(userThemePath, JSON.stringify(baseTheme, null, 2));
			if (baseTheme.vars) {
				baseTheme.vars.accent = "#ff00ff";
			}
			writeFileSync(projectThemePath, JSON.stringify(baseTheme, null, 2));

			const loader = createCodingAgentSessionResourceRuntime({ cwd, agentDir });
			await loader.reload();

			const prompt = loader.getPrompts().prompts.find((p) => p.name === "commit");
			expect(prompt?.filePath).toBe(projectPromptPath);

			const skill = loader.getSkills().skills.find((s) => s.name === "collision-skill");
			expect(skill?.filePath).toBe(projectSkillPath);

			const theme = loader.getThemes().themes.find((t) => t.name === "collision-theme");
			expect(theme?.sourcePath).toBe(projectThemePath);
		});

		it("should keep both extensions loaded when command names collide", async () => {
			const userExtDir = join(agentDir, "extensions");
			const projectExtDir = join(cwd, CONFIG_DIR_NAME, "extensions");
			mkdirSync(userExtDir, { recursive: true });
			mkdirSync(projectExtDir, { recursive: true });

			writeFileSync(
				join(projectExtDir, "project.ts"),
				`export default function(api) {
	api.registerCommand("deploy", {
		description: "project deploy",
		handler: async () => {},
	});
	api.registerCommand("project-only", {
		description: "project only",
		handler: async () => {},
	});
}`,
			);

			writeFileSync(
				join(userExtDir, "user.ts"),
				`export default function(api) {
	api.registerCommand("deploy", {
		description: "user deploy",
		handler: async () => {},
	});
	api.registerCommand("user-only", {
		description: "user only",
		handler: async () => {},
	});
}`,
			);

			const loader = createCodingAgentSessionResourceRuntime({ cwd, agentDir });
			await loader.reload();

			const extensionsResult = loader.getExtensions();
			expect(extensionsResult.extensions).toHaveLength(2);
			expect(extensionsResult.errors.some((e) => e.error.includes('Command "/deploy" conflicts'))).toBe(true);

			const sessionManager = createExtensionSessionView(cwd);
			const authStorage = createFileAuthStorage(join(tempDir, "auth.json"));
			const modelRuntime = createCodingAgentModelRuntime(authStorage);
			const runner = new ExtensionRunner(
				extensionsResult.extensions,
				extensionsResult.runtime,
				cwd,
				sessionManager,
				modelRuntime,
			);

			expect(runner.getCommand("deploy")?.description).toBe("project deploy");
			expect(runner.getCommand("project-only")?.description).toBe("project only");
			expect(runner.getCommand("user-only")?.description).toBe("user only");

			const commandNames = runner.getRegisteredCommands().map((c) => c.name);
			expect(commandNames.filter((name) => name === "deploy")).toHaveLength(1);
		});

		it("should honor overrides for auto-discovered resources", async () => {
			const settingsManager = SettingsRuntime.inMemory();
			settingsManager.setExtensionPaths([`-${join("extensions", "disabled.ts")}`]);
			settingsManager.setSkillPaths([`-${join("skills", "skip-skill")}`]);
			settingsManager.setPromptTemplatePaths([`-${join("prompts", "skip.md")}`]);
			settingsManager.setThemePaths([`-${join("themes", "skip.json")}`]);

			const extensionsDir = join(agentDir, "extensions");
			mkdirSync(extensionsDir, { recursive: true });
			writeFileSync(join(extensionsDir, "disabled.ts"), "export default function() {}");

			const skillDir = join(agentDir, "skills", "skip-skill");
			mkdirSync(skillDir, { recursive: true });
			writeFileSync(
				join(skillDir, "SKILL.md"),
				`---
name: skip-skill
description: Skip me
---
Content`,
			);

			const promptsDir = join(agentDir, "prompts");
			mkdirSync(promptsDir, { recursive: true });
			writeFileSync(join(promptsDir, "skip.md"), "Skip prompt");

			const themesDir = join(agentDir, "themes");
			mkdirSync(themesDir, { recursive: true });
			writeFileSync(join(themesDir, "skip.json"), "{}");

			const loader = createCodingAgentSessionResourceRuntime({ cwd, agentDir, settings: settingsManager });
			await loader.reload();

			const { extensions } = loader.getExtensions();
			const { skills } = loader.getSkills();
			const { prompts } = loader.getPrompts();
			const { themes } = loader.getThemes();

			expect(extensions.some((e) => e.path.endsWith("disabled.ts"))).toBe(false);
			expect(skills.some((s) => s.name === "skip-skill")).toBe(false);
			expect(prompts.some((p) => p.name === "skip")).toBe(false);
			expect(themes.some((t) => t.sourcePath?.endsWith("skip.json"))).toBe(false);
		});

		it("should discover AGENTS.md context files", async () => {
			writeFileSync(join(cwd, "AGENTS.md"), "# Project Guidelines\n\nBe helpful.");

			const loader = createCodingAgentSessionResourceRuntime({ cwd, agentDir });
			await loader.reload();

			const { agentsFiles } = loader.getAgentsFiles();
			expect(agentsFiles.some((f) => f.path.includes("AGENTS.md"))).toBe(true);
		});

		it("should discover SYSTEM.md from the project config directory", async () => {
			const configDir = join(cwd, CONFIG_DIR_NAME);
			mkdirSync(configDir, { recursive: true });
			writeFileSync(join(configDir, "SYSTEM.md"), "You are a helpful assistant.");

			const loader = createCodingAgentSessionResourceRuntime({ cwd, agentDir });
			await loader.reload();

			expect(loader.getSystemPrompt()).toBe("You are a helpful assistant.");
		});

		it("should discover APPEND_SYSTEM.md", async () => {
			const configDir = join(cwd, CONFIG_DIR_NAME);
			mkdirSync(configDir, { recursive: true });
			writeFileSync(join(configDir, "APPEND_SYSTEM.md"), "Additional instructions.");

			const loader = createCodingAgentSessionResourceRuntime({ cwd, agentDir });
			await loader.reload();

			expect(loader.getAppendSystemPrompt()).toContain("Additional instructions.");
		});

		it("should refresh prompt context resources created, changed, or deleted during a session", async () => {
			const loader = createCodingAgentSessionResourceRuntime({ cwd, agentDir });
			await loader.reload();
			const configDir = join(cwd, CONFIG_DIR_NAME);
			const agentsPath = join(cwd, "AGENTS.md");
			const systemPath = join(configDir, "SYSTEM.md");
			const appendPath = join(configDir, "APPEND_SYSTEM.md");

			expect(await loader.refreshContextResourcesIfChanged()).toBe(false);
			mkdirSync(configDir, { recursive: true });
			writeFileSync(agentsPath, "First project instruction");
			writeFileSync(systemPath, "First system prompt");
			writeFileSync(appendPath, "First appended prompt");
			expect(await loader.refreshContextResourcesIfChanged()).toBe(true);
			expect(loader.getAgentsFiles().agentsFiles[0]?.content).toBe("First project instruction");
			expect(loader.getSystemPrompt()).toBe("First system prompt");
			expect(loader.getAppendSystemPrompt()).toEqual(["First appended prompt"]);

			writeFileSync(agentsPath, "Second project instruction");
			writeFileSync(systemPath, "Second system prompt");
			writeFileSync(appendPath, "Second appended prompt");
			expect(await loader.refreshContextResourcesIfChanged()).toBe(true);
			expect(loader.getAgentsFiles().agentsFiles[0]?.content).toBe("Second project instruction");
			expect(loader.getSystemPrompt()).toBe("Second system prompt");
			expect(loader.getAppendSystemPrompt()).toEqual(["Second appended prompt"]);

			rmSync(agentsPath);
			rmSync(systemPath);
			rmSync(appendPath);
			expect(await loader.refreshContextResourcesIfChanged()).toBe(true);
			expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
			expect(loader.getSystemPrompt()).toBeUndefined();
			expect(loader.getAppendSystemPrompt()).toEqual([]);
		});
	});

	describe("extendResources", () => {
		it("should load skills and prompts with extension metadata", async () => {
			const extraSkillDir = join(tempDir, "extra-skills", "extra-skill");
			mkdirSync(extraSkillDir, { recursive: true });
			const skillPath = join(extraSkillDir, "SKILL.md");
			writeFileSync(
				skillPath,
				`---
name: extra-skill
description: Extra skill
---
Extra content`,
			);

			const extraPromptDir = join(tempDir, "extra-prompts");
			mkdirSync(extraPromptDir, { recursive: true });
			const promptPath = join(extraPromptDir, "extra.md");
			writeFileSync(
				promptPath,
				`---
description: Extra prompt
---
Extra prompt content`,
			);

			const loader = createCodingAgentSessionResourceRuntime({ cwd, agentDir });
			await loader.reload();

			await loader.extendResources({
				skillPaths: [
					{
						path: extraSkillDir,
						metadata: {
							source: "extension:extra",
							scope: "temporary",
							origin: "top-level",
							baseDir: extraSkillDir,
						},
					},
				],
				promptPaths: [
					{
						path: promptPath,
						metadata: {
							source: "extension:extra",
							scope: "temporary",
							origin: "top-level",
							baseDir: extraPromptDir,
						},
					},
				],
			});

			const { skills } = loader.getSkills();
			expect(skills.some((skill) => skill.name === "extra-skill")).toBe(true);

			const { prompts } = loader.getPrompts();
			expect(prompts.some((prompt) => prompt.name === "extra")).toBe(true);

			const metadata = loader.getPathMetadata();
			expect(metadata.get(skillPath)?.source).toBe("extension:extra");
			expect(metadata.get(promptPath)?.source).toBe("extension:extra");
		});

		it("should preserve the published prompt snapshot when an extension load is cancelled", async () => {
			const promptsDir = join(agentDir, "prompts");
			mkdirSync(promptsDir, { recursive: true });
			writeFileSync(join(promptsDir, "stable.md"), "Stable prompt");
			const cancelledPath = join(tempDir, "cancelled.md");
			writeFileSync(cancelledPath, "Cancelled prompt");
			const loader = createCodingAgentSessionResourceRuntime({ cwd, agentDir });
			await loader.reload();
			const published = loader.getPrompts().prompts;
			const controller = new AbortController();
			controller.abort(new DOMException("cancelled", "AbortError"));

			await expect(
				loader.extendResources(
					{
						promptPaths: [
							{
								path: cancelledPath,
								metadata: { source: "extension:cancelled", scope: "temporary", origin: "top-level" },
							},
						],
					},
					controller.signal,
				),
			).rejects.toMatchObject({ name: "AbortError" });
			expect(loader.getPrompts().prompts).toEqual(published);
			expect(loader.getPrompts().prompts.some(({ name }) => name === "cancelled")).toBe(false);
		});

		it("should serialize theme updates before publishing a new snapshot", async () => {
			const themeDocument = JSON.parse(
				readFileSync(fileURLToPath(new URL("../src/modes/interactive/theme/dark.json", import.meta.url)), "utf-8"),
			) as { name: string };
			const firstThemePath = join(tempDir, "first-theme.json");
			const secondThemePath = join(tempDir, "second-theme.json");
			writeFileSync(firstThemePath, JSON.stringify({ ...themeDocument, name: "first-theme" }));
			writeFileSync(secondThemePath, JSON.stringify({ ...themeDocument, name: "second-theme" }));

			const nodeAccess = createNodeResourceAccess();
			let releaseFirstRead: () => void = () => undefined;
			const firstReadBlocked = new Promise<void>((resolve) => {
				releaseFirstRead = resolve;
			});
			let notifyFirstRead: () => void = () => undefined;
			const firstReadStarted = new Promise<void>((resolve) => {
				notifyFirstRead = resolve;
			});
			let blockFirstRead = true;
			const readPaths: string[] = [];
			const resourceAccess = {
				paths: nodeAccess.paths,
				files: {
					...nodeAccess.files,
					async readText(path: string, options?: { signal?: AbortSignal }): Promise<string> {
						readPaths.push(path);
						if (path === firstThemePath && blockFirstRead) {
							blockFirstRead = false;
							notifyFirstRead();
							await firstReadBlocked;
						}
						return nodeAccess.files.readText(path, options);
					},
				},
			};
			const loader = createCodingAgentSessionResourceRuntime({ cwd, agentDir, resourceAccess });
			await loader.reload();
			readPaths.length = 0;
			const metadata = { source: "extension:theme", scope: "temporary", origin: "top-level" } as const;

			const firstUpdate = loader.extendResources({ themePaths: [{ path: firstThemePath, metadata }] });
			await firstReadStarted;
			const secondUpdate = loader.extendResources({ themePaths: [{ path: secondThemePath, metadata }] });
			await new Promise<void>((resolve) => setImmediate(resolve));

			expect(readPaths).toEqual([firstThemePath]);
			releaseFirstRead();
			await Promise.all([firstUpdate, secondUpdate]);
			expect(loader.getThemes().themes.map(({ name }) => name)).toEqual(["first-theme", "second-theme"]);
		});
	});

	describe("noSkills option", () => {
		it("should skip skill discovery when noSkills is true", async () => {
			const skillsDir = join(agentDir, "skills");
			mkdirSync(skillsDir, { recursive: true });
			writeFileSync(
				join(skillsDir, "test-skill.md"),
				`---
name: test-skill
description: A test skill
---
Content`,
			);

			const loader = createCodingAgentSessionResourceRuntime({ cwd, agentDir, noSkills: true });
			await loader.reload();

			const { skills } = loader.getSkills();
			expect(skills).toEqual([]);
		});

		it("should still load additional skill paths when noSkills is true", async () => {
			const customSkillDir = join(tempDir, "custom-skills");
			mkdirSync(customSkillDir, { recursive: true });
			writeFileSync(
				join(customSkillDir, "custom.md"),
				`---
name: custom
description: Custom skill
---
Content`,
			);

			const loader = createCodingAgentSessionResourceRuntime({
				cwd,
				agentDir,
				noSkills: true,
				additionalSkillPaths: [customSkillDir],
			});
			await loader.reload();

			const { skills } = loader.getSkills();
			expect(skills.some((s) => s.name === "custom")).toBe(true);
		});
	});

	describe("override functions", () => {
		it("should apply skillsOverride", async () => {
			const injectedSkill: Skill = {
				name: "injected",
				description: "Injected skill",
				filePath: "/fake/path",
				baseDir: "/fake",
				source: "custom",
				type: "skill",
				disableModelInvocation: false,
				content: "Injected content",
				sceneTasks: [],
			};
			const loader = createCodingAgentSessionResourceRuntime({
				cwd,
				agentDir,
				skillsOverride: () => ({
					skills: [injectedSkill],
					diagnostics: [],
				}),
			});
			await loader.reload();

			const { skills } = loader.getSkills();
			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("injected");
		});

		it("should apply systemPromptOverride", async () => {
			const loader = createCodingAgentSessionResourceRuntime({
				cwd,
				agentDir,
				systemPromptOverride: () => "Custom system prompt",
			});
			await loader.reload();

			expect(loader.getSystemPrompt()).toBe("Custom system prompt");
		});
	});

	describe("extension conflict detection", () => {
		it("should detect tool conflicts between extensions", async () => {
			// Create two extensions that register the same tool
			const ext1Dir = join(agentDir, "extensions", "ext1");
			const ext2Dir = join(agentDir, "extensions", "ext2");
			mkdirSync(ext1Dir, { recursive: true });
			mkdirSync(ext2Dir, { recursive: true });

			writeFileSync(
				join(ext1Dir, "index.ts"),
				`
import type { ExtensionAPI } from "@vetta/coding-agent";
import { Type } from "@sinclair/typebox";
export default function(api: ExtensionAPI) {
  api.registerTool({
    name: "duplicate-tool",
    description: "First",
    parameters: Type.Object({}),
    execute: async () => ({ result: "1" }),
  });
}`,
			);

			writeFileSync(
				join(ext2Dir, "index.ts"),
				`
import type { ExtensionAPI } from "@vetta/coding-agent";
import { Type } from "@sinclair/typebox";
export default function(api: ExtensionAPI) {
  api.registerTool({
    name: "duplicate-tool",
    description: "Second",
    parameters: Type.Object({}),
    execute: async () => ({ result: "2" }),
  });
}`,
			);

			const loader = createCodingAgentSessionResourceRuntime({ cwd, agentDir });
			await loader.reload();

			const { errors } = loader.getExtensions();
			expect(errors.some((e) => e.error.includes("duplicate-tool") && e.error.includes("conflicts"))).toBe(true);
		});
	});
});
