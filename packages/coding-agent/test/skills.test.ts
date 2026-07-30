import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "os";
import { join, resolve } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONFIG_DIR_NAME } from "../src/config.js";
import type { ResourceDiagnostic } from "../src/core/diagnostics.js";
import { formatSkillsForPrompt, loadSkills, loadSkillsFromDir, type Skill } from "../src/core/skills.js";

const fixturesDir = resolve(__dirname, "fixtures/skills");
const collisionFixturesDir = resolve(__dirname, "fixtures/skills-collision");

describe("skills", () => {
	describe("loadSkillsFromDir", () => {
		it("should load a valid skill", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "valid-skill"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("valid-skill");
			expect(skills[0].description).toBe("A valid skill for testing purposes.");
			expect(skills[0].source).toBe("test");
			expect(diagnostics).toHaveLength(0);
		});

		it("should warn when name doesn't match parent directory", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "name-mismatch"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("different-name");
			expect(
				diagnostics.some((d: ResourceDiagnostic) => d.message.includes("does not match parent directory")),
			).toBe(true);
		});

		it("should warn when name contains invalid characters", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "invalid-name-chars"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("invalid characters"))).toBe(true);
		});

		it("should warn when name exceeds 64 characters", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "long-name"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("exceeds 64 characters"))).toBe(true);
		});

		it("should warn and skip skill when description is missing", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "missing-description"),
				source: "test",
			});

			expect(skills).toHaveLength(0);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("description is required"))).toBe(true);
		});

		it("should ignore unknown frontmatter fields", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "unknown-field"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(diagnostics).toHaveLength(0);
		});

		it("should load nested skills recursively", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "nested"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("child-skill");
			expect(diagnostics).toHaveLength(0);
		});

		it("should skip files without frontmatter", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "no-frontmatter"),
				source: "test",
			});

			// no-frontmatter has no description, so it should be skipped
			expect(skills).toHaveLength(0);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("description is required"))).toBe(true);
		});

		it("should warn and skip skill when YAML frontmatter is invalid", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "invalid-yaml"),
				source: "test",
			});

			expect(skills).toHaveLength(0);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("at line"))).toBe(true);
		});

		it("should preserve multiline descriptions from YAML", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "multiline-description"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].description).toContain("\n");
			expect(skills[0].description).toContain("This is a multiline description.");
			expect(diagnostics).toHaveLength(0);
		});

		it("should warn when name contains consecutive hyphens", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "consecutive-hyphens"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("consecutive hyphens"))).toBe(true);
		});

		it("should load all skills from fixture directory", () => {
			const { skills } = loadSkillsFromDir({
				dir: fixturesDir,
				source: "test",
			});

			// Should load all skills that have descriptions (even with warnings)
			// valid-skill, name-mismatch, invalid-name-chars, long-name, unknown-field, nested/child-skill, consecutive-hyphens
			// NOT: missing-description, no-frontmatter (both missing descriptions)
			expect(skills.length).toBeGreaterThanOrEqual(6);
		});

		it("should return empty for non-existent directory", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: "/non/existent/path",
				source: "test",
			});

			expect(skills).toHaveLength(0);
			expect(diagnostics).toHaveLength(0);
		});

		it("should use parent directory name when name not in frontmatter", () => {
			// The no-frontmatter fixture has no name in frontmatter, so it should use "no-frontmatter"
			// But it also has no description, so it won't load
			// Let's test with a valid skill that relies on directory name
			const { skills } = loadSkillsFromDir({
				dir: join(fixturesDir, "valid-skill"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("valid-skill");
		});

		it("should parse disable-model-invocation frontmatter field", () => {
			const { skills, diagnostics } = loadSkillsFromDir({
				dir: join(fixturesDir, "disable-model-invocation"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("disable-model-invocation");
			expect(skills[0].disableModelInvocation).toBe(true);
			// Should not warn about unknown field
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("unknown frontmatter field"))).toBe(
				false,
			);
		});

		it("should default disableModelInvocation to false when not specified", () => {
			const { skills } = loadSkillsFromDir({
				dir: join(fixturesDir, "valid-skill"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].disableModelInvocation).toBe(false);
		});
	});

	describe("formatSkillsForPrompt", () => {
		it("should return empty string for no skills", () => {
			const result = formatSkillsForPrompt([]);
			expect(result).toBe("");
		});

		it("should format skills as XML", () => {
			const skills: Skill[] = [
				{
					name: "test-skill",
					description: "A test skill.",
					filePath: "/path/to/skill/SKILL.md",
					baseDir: "/path/to/skill",
					source: "test",
					type: "skill",
					disableModelInvocation: false,
				},
			];

			const result = formatSkillsForPrompt(skills);

			expect(result).toContain("<available_skills>");
			expect(result).toContain("</available_skills>");
			expect(result).toContain("<skill>");
			expect(result).toContain("<name>test-skill</name>");
			expect(result).toContain("<description>A test skill.</description>");
			expect(result).toContain("<location>/path/to/skill/SKILL.md</location>");
		});

		it("should include intro text before XML", () => {
			const skills: Skill[] = [
				{
					name: "test-skill",
					description: "A test skill.",
					filePath: "/path/to/skill/SKILL.md",
					baseDir: "/path/to/skill",
					source: "test",
					type: "skill",
					disableModelInvocation: false,
				},
			];

			const result = formatSkillsForPrompt(skills);
			const xmlStart = result.indexOf("<available_skills>");
			const introText = result.substring(0, xmlStart);

			expect(introText).toContain("The following skills provide specialized instructions");
			expect(introText).toContain("Use the read tool to load a skill's file");
		});

		it("should escape XML special characters", () => {
			const skills: Skill[] = [
				{
					name: "test-skill",
					description: 'A skill with <special> & "characters".',
					filePath: "/path/to/skill/SKILL.md",
					baseDir: "/path/to/skill",
					source: "test",
					type: "skill",
					disableModelInvocation: false,
				},
			];

			const result = formatSkillsForPrompt(skills);

			expect(result).toContain("&lt;special&gt;");
			expect(result).toContain("&amp;");
			expect(result).toContain("&quot;characters&quot;");
		});

		it("should format multiple skills", () => {
			const skills: Skill[] = [
				{
					name: "skill-one",
					description: "First skill.",
					filePath: "/path/one/SKILL.md",
					baseDir: "/path/one",
					source: "test",
					type: "skill",
					disableModelInvocation: false,
				},
				{
					name: "skill-two",
					description: "Second skill.",
					filePath: "/path/two/SKILL.md",
					baseDir: "/path/two",
					source: "test",
					type: "skill",
					disableModelInvocation: false,
				},
			];

			const result = formatSkillsForPrompt(skills);

			expect(result).toContain("<name>skill-one</name>");
			expect(result).toContain("<name>skill-two</name>");
			expect((result.match(/<skill>/g) || []).length).toBe(2);
		});

		it("should exclude skills with disableModelInvocation from prompt", () => {
			const skills: Skill[] = [
				{
					name: "visible-skill",
					description: "A visible skill.",
					filePath: "/path/visible/SKILL.md",
					baseDir: "/path/visible",
					source: "test",
					type: "skill",
					disableModelInvocation: false,
				},
				{
					name: "hidden-skill",
					description: "A hidden skill.",
					filePath: "/path/hidden/SKILL.md",
					baseDir: "/path/hidden",
					source: "test",
					type: "skill",
					disableModelInvocation: true,
				},
			];

			const result = formatSkillsForPrompt(skills);

			expect(result).toContain("<name>visible-skill</name>");
			expect(result).not.toContain("<name>hidden-skill</name>");
			expect((result.match(/<skill>/g) || []).length).toBe(1);
		});

		it("should return empty string when all skills have disableModelInvocation", () => {
			const skills: Skill[] = [
				{
					name: "hidden-skill",
					description: "A hidden skill.",
					filePath: "/path/hidden/SKILL.md",
					baseDir: "/path/hidden",
					source: "test",
					type: "skill",
					disableModelInvocation: true,
				},
			];

			const result = formatSkillsForPrompt(skills);
			expect(result).toBe("");
		});
	});

	describe("loadSkills with options", () => {
		const emptyAgentDir = resolve(__dirname, "fixtures/empty-agent");
		const emptyCwd = resolve(__dirname, "fixtures/empty-cwd");
		const emptySceneDir = resolve(__dirname, "fixtures/empty-scene");

		it("should load from explicit skillPaths", () => {
			const { skills, diagnostics } = loadSkills({
				agentDir: emptyAgentDir,
				cwd: emptyCwd,
				sceneDir: emptySceneDir,
				skillPaths: [join(fixturesDir, "valid-skill")],
				// Keep this assertion hermetic against the developer's real ~/.agents/skills.
				includeAgentSkills: false,
			});
			expect(skills).toHaveLength(1);
			expect(skills[0].source).toBe("path");
			expect(diagnostics).toHaveLength(0);
		});

		it("should warn when skill path does not exist", () => {
			const { skills, diagnostics } = loadSkills({
				agentDir: emptyAgentDir,
				cwd: emptyCwd,
				sceneDir: emptySceneDir,
				skillPaths: ["/non/existent/path"],
				includeAgentSkills: false,
			});
			expect(skills).toHaveLength(0);
			expect(diagnostics.some((d: ResourceDiagnostic) => d.message.includes("does not exist"))).toBe(true);
		});

		it("should expand ~ in skillPaths", () => {
			const homeSkillsDir = join(homedir(), ".pi/agent/skills");
			const { skills: withTilde } = loadSkills({
				agentDir: emptyAgentDir,
				cwd: emptyCwd,
				skillPaths: ["~/.pi/agent/skills"],
			});
			const { skills: withoutTilde } = loadSkills({
				agentDir: emptyAgentDir,
				cwd: emptyCwd,
				skillPaths: [homeSkillsDir],
			});
			expect(withTilde.length).toBe(withoutTilde.length);
		});
	});

	describe("generic Agent Skill dirs (.agents/skills)", () => {
		const emptyAgentDir = resolve(__dirname, "fixtures/empty-agent");
		const emptySceneDir = resolve(__dirname, "fixtures/empty-scene");
		// Built at runtime in a temp dir: `.agents/` is gitignored, so these fixtures
		// can't live under test/fixtures and must be created on the fly.
		let tmpRoot: string;
		let agentsProjectCwd: string;
		let agentsPriorityCwd: string;

		const writeSkill = (dir: string, name: string, description: string): void => {
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`);
		};

		beforeAll(() => {
			tmpRoot = mkdtempSync(join(tmpdir(), "vetta-agents-skills-"));
			agentsProjectCwd = join(tmpRoot, "project");
			agentsPriorityCwd = join(tmpRoot, "priority");

			// project cwd: one valid generic skill + a loose root .md that must be ignored.
			writeSkill(
				join(agentsProjectCwd, ".agents", "skills", "generic-agent-skill"),
				"generic-agent-skill",
				"A generic Agent Skill discovered from the .agents/skills convention directory.",
			);
			writeFileSync(
				join(agentsProjectCwd, ".agents", "skills", "loose-root.md"),
				"---\nname: loose-root\ndescription: Loose root .md that must be ignored under the subdir-only rule.\n---\n",
			);

			// priority cwd: same-named skill in both Vetta project (.vetta) and generic (.agents).
			writeSkill(
				join(agentsPriorityCwd, CONFIG_DIR_NAME, "skills", "shared-skill"),
				"shared-skill",
				"Vetta-native project skill that must win the collision.",
			);
			writeSkill(
				join(agentsPriorityCwd, ".agents", "skills", "shared-skill"),
				"shared-skill",
				"Generic Agent Skill that must lose the collision.",
			);
		});

		afterAll(() => {
			rmSync(tmpRoot, { recursive: true, force: true });
		});

		it("discovers <cwd>/.agents/skills subdir SKILL.md tagged source=agents-project, ignoring loose root .md", () => {
			const { skills } = loadSkills({
				agentDir: emptyAgentDir,
				cwd: agentsProjectCwd,
				sceneDir: emptySceneDir,
				includeDefaults: false,
				includeAgentSkills: true,
			});
			const generic = skills.find((s) => s.name === "generic-agent-skill");
			expect(generic).toBeDefined();
			expect(generic?.source).toBe("agents-project");
			// subdirectory-only rule: loose root .md must not be discovered
			expect(skills.some((s) => s.name === "loose-root")).toBe(false);
		});

		it("does not discover .agents/skills when includeAgentSkills is false", () => {
			const { skills } = loadSkills({
				agentDir: emptyAgentDir,
				cwd: agentsProjectCwd,
				sceneDir: emptySceneDir,
				includeDefaults: false,
				includeAgentSkills: false,
			});
			expect(skills.some((s) => s.name === "generic-agent-skill")).toBe(false);
		});

		it("lets a Vetta-native project skill win a name collision over the generic Agent Skill", () => {
			const { skills, diagnostics } = loadSkills({
				agentDir: emptyAgentDir,
				cwd: agentsPriorityCwd,
				sceneDir: emptySceneDir,
				includeDefaults: true,
				includeAgentSkills: true,
			});
			const shared = skills.find((s) => s.name === "shared-skill");
			expect(shared).toBeDefined();
			// Vetta project dir loads before .agents/skills, so it wins.
			expect(shared?.source).toBe("project");
			expect(
				diagnostics.some(
					(d: ResourceDiagnostic) => d.collision?.resourceType === "skill" && d.collision.name === "shared-skill",
				),
			).toBe(true);
		});

		it("lets an explicit skillPaths skill win over the generic Agent Skill (desktop/session path)", () => {
			// desktop 与会话运行时都是 includeDefaults:false + 显式 skillPaths，
			// 通用目录必须在这条路径下同样让位，否则同名 skill 会被重复感知。
			const { skills } = loadSkills({
				agentDir: emptyAgentDir,
				cwd: agentsPriorityCwd,
				sceneDir: emptySceneDir,
				includeDefaults: false,
				includeAgentSkills: true,
				skillPaths: [join(agentsPriorityCwd, CONFIG_DIR_NAME, "skills")],
			});
			const shared = skills.filter((s) => s.name === "shared-skill");
			expect(shared).toHaveLength(1);
			expect(shared[0].source).toBe("project");
		});
	});

	describe("collision handling", () => {
		it("should detect name collisions and keep first skill", () => {
			// Load from first directory
			const first = loadSkillsFromDir({
				dir: join(collisionFixturesDir, "first"),
				source: "first",
			});

			const second = loadSkillsFromDir({
				dir: join(collisionFixturesDir, "second"),
				source: "second",
			});

			// Simulate the collision behavior from loadSkills()
			const skillMap = new Map<string, Skill>();
			const collisionWarnings: Array<{ skillPath: string; message: string }> = [];

			for (const skill of first.skills) {
				skillMap.set(skill.name, skill);
			}

			for (const skill of second.skills) {
				const existing = skillMap.get(skill.name);
				if (existing) {
					collisionWarnings.push({
						skillPath: skill.filePath,
						message: `name collision: "${skill.name}" already loaded from ${existing.filePath}`,
					});
				} else {
					skillMap.set(skill.name, skill);
				}
			}

			expect(skillMap.size).toBe(1);
			expect(skillMap.get("calendar")?.source).toBe("first");
			expect(collisionWarnings).toHaveLength(1);
			expect(collisionWarnings[0].message).toContain("name collision");
		});
	});
});
