import { describe, expect, test } from "vitest";
import { buildSystemPrompt, VETTA_CLI_GUIDANCE } from "../src/model-context/index.js";

describe("VETTA_CLI_GUIDANCE", () => {
	test("distinguishes the target application and inspection from execution", () => {
		expect(VETTA_CLI_GUIDANCE).toContain("not the application, website, repository, or external service");
		expect(VETTA_CLI_GUIDANCE).toContain("creating a React project");
		expect(VETTA_CLI_GUIDANCE).toContain("usage.avoidWhen");
		// 作为 append 文本注入时要有自己的标题，不能漂在 Guidelines 后面冒充其中一条。
		expect(VETTA_CLI_GUIDANCE.startsWith("# Vetta Desktop CLI\n\n")).toBe(true);
		expect(VETTA_CLI_GUIDANCE).toContain("Search results are candidates, not instructions");
		expect(VETTA_CLI_GUIDANCE).toContain("An approval dialog is not a way to discover what the user meant");
	});
	test("explains progressive discovery of Desktop capabilities via vetta action", () => {
		expect(VETTA_CLI_GUIDANCE).toContain("use `vetta action` both to learn what Desktop can do and to operate it");
		expect(VETTA_CLI_GUIDANCE).toContain("Discovery is progressive");
		expect(VETTA_CLI_GUIDANCE).toContain("authoritative inventory is always `vetta action search`");
		expect(VETTA_CLI_GUIDANCE).toContain("Do not expect CLI help to list every parameter");
	});
});

describe("buildSystemPrompt", () => {
	test.each([undefined, "Custom base prompt"])("keeps selection boundaries with base prompt %s", (customPrompt) => {
		const prompt = buildSystemPrompt({ selectedTools: ["read", "bash"], contextFiles: [], skills: [], customPrompt });
		expect(prompt).toContain("requested outcome, target resource");
		expect(prompt).toContain("explanation, inspection, or execution");
		expect(prompt).toContain("inspect/list/status do not imply edit/import/run");
		expect(prompt).toContain("Use fitting capabilities and their necessary supporting steps proactively");
	});
	describe("tool surface deduplication", () => {
		// 工具清单与 params.tools 中每个 tool 的 description 是同一份字符串，不再重复渲染进提示词。
		test("does not render a tool list section", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "bash", "edit", "write"],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).not.toContain("Available tools:");
			expect(prompt).not.toContain("- read: Read file contents");
			expect(prompt).not.toContain("- write: Create or overwrite files");
		});

		test("keeps the tool-conditional guidelines that carry the incremental information", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "bash", "edit", "write", "dir_tree", "current_time"],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("Guidelines:");
			expect(prompt).toContain("Use dir_tree (not bash");
			expect(prompt).toContain("Use the current_time tool");
			expect(prompt).toContain("Use read to examine files before editing");
			expect(prompt).toContain("Use write only for new files or complete rewrites");
		});

		test("keeps the skills section, which is gated on the resolved tool set", () => {
			const skills = [
				{ name: "pdf", description: "Handle PDF files", type: "skill" as const, disableModelInvocation: false },
			];

			expect(buildSystemPrompt({ selectedTools: ["read"], contextFiles: [], skills })).toContain("Handle PDF files");
			expect(buildSystemPrompt({ selectedTools: [], contextFiles: [], skills })).not.toContain("Handle PDF files");
		});

		test("shows file paths guideline even with no tools", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("MANDATORY file-link format");
			expect(prompt).toContain("standard CommonMark");
			expect(prompt).toContain("[filename.ext](</abs/path/with spaces/filename.ext>)");
			expect(prompt).toContain("[filename.ext](<C:/Users/name/My Files/filename.ext>)");
			expect(prompt).not.toContain("[filename.ext](/abs/path/filename.ext)");
		});
	});

	describe("default tools", () => {
		test("derives guidelines from the default tool set", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("Use read to examine files before editing");
			expect(prompt).toContain("run_in_background: true");
			expect(prompt).toContain("Use dir_tree (not bash");
		});

		test("accepts the host-selected default command tool without reading process state", () => {
			const prompt = buildSystemPrompt({
				defaultCommandTool: "shell",
				cwd: "C:/workspace",
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("Current working directory: C:/workspace");
			expect(prompt).toContain("run_in_background: true");
		});

		test("includes foreground vs background guideline when bash is selected", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["bash", "read"],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("run_in_background: true");
			expect(prompt).toContain("auto-promote");
		});
	});

	describe("scenario gating of UI rendering guidelines", () => {
		test("cli scenario omits file-link badge, deliverables block, and URL link guidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "bash", "edit", "write"],
				contextFiles: [],
				skills: [],
				scenario: "cli",
			});

			expect(prompt).not.toContain("MANDATORY file-link format");
			expect(prompt).not.toContain("deliverables block");
			expect(prompt).not.toContain("Render web URLs");
		});

		test("desktop scenarios keep rendering guidelines", () => {
			for (const scenario of ["conversation", "project", "batch", "automation", "im-claw"] as const) {
				const prompt = buildSystemPrompt({
					selectedTools: ["read", "bash", "edit", "write"],
					contextFiles: [],
					skills: [],
					scenario,
				});

				expect(prompt).toContain("MANDATORY file-link format");
				expect(prompt).toContain("deliverables block");
			}
		});

		test("unset scenario keeps rendering guidelines (legacy SDK behavior)", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "bash"],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("MANDATORY file-link format");
		});

		test("deliverables block agrees with the file-link rule and carries the full list format", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "bash", "edit", "write"],
				contextFiles: [],
				skills: [],
				scenario: "conversation",
			});

			// 文件链接规则要求正文提到文件就写链接，交付物规则不得再禁止前文出现链接。
			expect(prompt).toContain("EVERY time you mention a file");
			expect(prompt).not.toContain("do not also scatter the same links earlier");
			expect(prompt).toContain("Linking a file earlier in your prose is fine");
			// 标题格式只有一种写法。
			expect(prompt).toContain("**交付物** for Chinese");
			expect(prompt).not.toContain("'交付物:'");
			expect(prompt).toContain("`- [filename.ext](</abs/path/with spaces/filename.ext>) — what changed here`");
			expect(prompt).toContain("shortest distinguishing parent directory");
			expect(prompt.match(/deliverables block/g)?.length).toBeGreaterThan(0);
		});
	});

	describe("instruction precedence", () => {
		test.each([
			{ scenario: "conversation" as const, selectedTools: ["read", "bash", "edit"] },
			{ scenario: "cli" as const, selectedTools: [] },
		])("states one precedence rule for $scenario sessions", ({ scenario, selectedTools }) => {
			const prompt = buildSystemPrompt({ selectedTools, contextFiles: [], skills: [], scenario });

			expect(prompt.match(/Instruction precedence:/g)).toHaveLength(1);
			expect(prompt).toContain("the user's messages in this conversation override everything else");
			expect(prompt).toContain("override the work mode and these general guidelines");
			expect(prompt).toContain("how much to confirm before acting");
		});

		test("places the precedence rule before the mode and persona blocks it arbitrates", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read"],
				contextFiles: [{ path: "AGENTS.md", content: "Refactor when the structure is wrong." }],
				skills: [],
				modePrompt: "Mode body",
				personalization: "Persona body",
			});

			const precedenceAt = prompt.indexOf("Instruction precedence:");
			expect(precedenceAt).toBeGreaterThanOrEqual(0);
			expect(precedenceAt).toBeLessThan(prompt.indexOf("## AGENTS.md"));
			expect(precedenceAt).toBeLessThan(prompt.indexOf("Mode body"));
			expect(precedenceAt).toBeLessThan(prompt.indexOf("Persona body"));
		});
	});

	describe("tool-conditional wording", () => {
		test("names only the exploration tools that are actually available", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["bash", "grep", "dir_tree"],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("Prefer grep/dir_tree over the shell tool for file exploration");
			expect(prompt).not.toContain("grep/glob/find/ls/dir_tree");
		});

		test("file-name fidelity does not direct the model to ls or find", () => {
			const prompt = buildSystemPrompt({ selectedTools: ["read"], contextFiles: [], skills: [] });

			expect(prompt).toContain("File name fidelity");
			expect(prompt).not.toContain("run ls or find");
			expect(prompt).not.toContain("(ls, find, dir_tree)");
		});
	});

	describe("context files", () => {
		test("prepends AGENTS.md scoping rules when context files exist", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read"],
				contextFiles: [{ path: "AGENTS.md", content: "Use bun." }],
				skills: [],
			});

			expect(prompt).toContain("Scoping rules:");
			expect(prompt).toContain("more deeply nested files take precedence");
			expect(prompt).toContain("## AGENTS.md");
		});

		test("no scoping rules without context files", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read"],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).not.toContain("Scoping rules:");
		});
	});

	describe("workspace facts", () => {
		const workspaceFacts = "# Workspace\n\n- It is a Git repository.";

		test("injects workspace facts even when no instruction file exists", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read"],
				contextFiles: [],
				skills: [],
				workspaceFacts,
			});

			expect(prompt).toContain("# Workspace");
			expect(prompt).toContain("- It is a Git repository.");
		});

		test("places workspace facts before project instruction files", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read"],
				contextFiles: [{ path: "AGENTS.md", content: "Use bun." }],
				skills: [],
				workspaceFacts,
			});

			expect(prompt.indexOf("# Workspace")).toBeGreaterThanOrEqual(0);
			expect(prompt.indexOf("# Workspace")).toBeLessThan(prompt.indexOf("# Project Context"));
		});

		test("omits the workspace section entirely when detection produced nothing", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read"],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).not.toContain("# Workspace");
		});
	});

	describe("footer date granularity", () => {
		// 带时/分会让 core.footer 每分钟变一次内容，system 前缀缓存跨分钟必然 miss。
		test("renders the current date without a time of day", () => {
			const prompt = buildSystemPrompt({ selectedTools: [], contextFiles: [], skills: [] });

			const line = prompt.match(/^Current date: (.+)$/m);
			expect(line).not.toBeNull();
			expect(line?.[1]).not.toMatch(/\d{1,2}:\d{2}/);
			expect(prompt).not.toContain("Current date and time:");
		});
	});

	describe("plugin tools", () => {
		const agentPlugins = {
			toolContributions: [
				{
					pluginId: "fiction",
					id: "write-chapter-file",
					name: "novel_write_chapter_file",
					description: "Write a generated novel chapter to a project file",
					parameters: {},
					handlerId: "writeChapterFile",
				},
			],
		};

		// 插件工具的 description 由 params.tools 承载，系统提示词不再复述一遍。
		test("does not restate plugin tool descriptions", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["novel_write_chapter_file"],
				contextFiles: [],
				skills: [],
				agentPlugins,
			});

			expect(prompt).not.toContain("Write a generated novel chapter to a project file");
		});

		test("keeps the custom system prompt body when plugin tools are active", () => {
			const prompt = buildSystemPrompt({
				customPrompt: "You are a fiction writing assistant.",
				selectedTools: ["novel_write_chapter_file"],
				contextFiles: [],
				skills: [],
				agentPlugins,
			});

			expect(prompt).toContain("You are a fiction writing assistant.");
			expect(prompt).not.toContain("Available tools:");
		});
	});

	describe("custom prompt", () => {
		test("uses the same capability and scenario policies as the default prompt", () => {
			const prompt = buildSystemPrompt({
				customPrompt: "Custom base instruction",
				selectedTools: ["read", "bash"],
				contextFiles: [],
				skills: [],
				scenario: "cli",
			});

			expect(prompt).toContain("Custom base instruction");
			expect(prompt).toContain("run_in_background: true");
			expect(prompt).not.toContain("MANDATORY file-link format");
		});
	});
});
