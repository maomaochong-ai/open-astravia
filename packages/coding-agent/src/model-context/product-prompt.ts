/** Coding Agent product prompt policy and model-call prompt assembly. */

import type { ConversationScenario } from "@vetta/runtime-core";
import type { AgentPluginRuntimeConfig } from "./plugin-runtime.js";
import {
	applySystemPromptOperations,
	coreBlock,
	renderSystemPromptDraft,
	type SystemPromptBlock,
	type SystemPromptDraft,
} from "./prompt-document.js";
import { formatSkillsForProductPrompt, type ProductPromptSkill } from "./skill-prompt.js";

const SUBCONSCIOUS = `**Your name is Vetta. You are an AI assistant.**`;

/** Tool descriptions for system prompt */
const toolDescriptions: Record<string, string> = {
	read: "Read file contents",
	bash: "Execute bash commands (ls, grep, find, etc.)",
	shell: "Execute shell commands (PowerShell on Windows by default)",
	edit: "Make surgical edits to files — anchor mode (batch, atomic, anchors from read/grep output) or exact-text replace",
	write: "Create or overwrite files",
	grep: "Search file contents for patterns (respects .gitignore)",
	glob: "Find files by glob pattern (respects .gitignore)",
	find: "Find files by glob pattern (respects .gitignore)",
	ls: "List directory contents",
	dir_tree: "Render directory tree with [D]/[F] node types and child counts",
	invoke_skill: "Invoke a skill by name to handle specialized tasks (e.g., PDF, DOCX processing)",
	todo: "Plan and track progress on multi-step tasks with a todo list",
	task_output: "Read incremental output of a background task started via bash/shell with run_in_background",
	task_stop: "Terminate a running background task started via bash/shell with run_in_background",
	current_time: "Get the current date and time (preferred over bash date/time commands)",
	progress:
		"Announce the current stage in plain language so the user sees readable steps instead of raw tool calls (Work mode only)",
	ask_user_question:
		"Ask the user multiple-choice questions and wait for their answers (clarify ambiguity, gather preferences, offer decisions)",
	doc_to_pdf: "Convert .doc/.docx files to PDF using Microsoft Office or WPS Office",
	html_to_pdf: "Convert HTML files to PDF using Vetta Desktop's PDF command-line mode",
	extract_text_from_pdf:
		"Extract text from a PDF (scanned or born-digital) via Vetta Desktop's local PP-OCRv5 OCR; uses the embedded text layer when present, otherwise OCRs each page",
	extract_text_from_img:
		"Extract text from a single image (PNG/JPG/WebP/BMP/GIF) via Vetta Desktop's local PP-OCRv5 OCR",
	render_pdf_page:
		"Render a single PDF page to a PNG (via pdftoppm) for visual inspection (seals/stamps, signatures, handwriting, layout); follow up with `read` on the returned PNG path. Use when the task needs a visual judgment OCR cannot make.",
	kb_write_page:
		"Create or update a knowledge base wiki page (closed frontmatter schema, stable id, upsert by id/source_hash, auto-refreshes tag/manifest caches)",
	kb_filter_by_tags:
		"Filter knowledge base wiki pages by tags using set algebra (all=AND, any=OR, none=NOT); a retrieval shortcut",
	kb_list_available_tags: "List all tags in the knowledge base with page counts; call before kb_filter_by_tags",
	tool_search: "Search the deferred MCP tool index by keyword and activate matching tools so they become callable",
};

export const VETTA_CLI_GUIDANCE = [
	"Vetta CLI is your interface to the running Vetta Desktop app: use `vetta action` both to learn what Desktop can do and to operate it.",
	'Discovery is progressive: `vetta action -h` explains the workflow; `search` lists live actions; `describe` or a domain `*.query` with `{"operation":"help"}` reveals inputs; then `run`.',
	"Do not expect CLI help to list every parameter. Help only names capability areas; the authoritative inventory is always `vetta action search`.",
	"Before using Vetta CLI, decide whether the user wants to inspect/operate the running app or wants a general feature explanation; only explain capabilities when explicitly asked for an introduction, and ask a concise clarifying question when intent is unclear.",
	"When the user asks about Vetta Desktop app features, settings, pages, models, skills, projects, automation, knowledge, plugins, IM, or how to operate the app, you MUST start with `vetta action -h` and/or `vetta action search`, then describe/run as needed. Never answer by guessing from memory or by inspecting files under `.vetta`; local config files are not the app UX contract.",
	"Do not memorize or guess detailed action parameters; get them from search/describe/help output, then call `vetta action run` directly.",
	"Never show or quote Vetta CLI commands, arguments, or raw terminal output. Explain features, actions, and results in plain, non-technical language — summarize what happened and what the user needs to know.",
	"Actions that require authorization automatically ask the user through Vetta Desktop while the command runs; do not ask for authorization beforehand, and do not retry after the user rejects.",
].join(" ");

/**
 * 产物输出位置规则：用户未显式指定输出位置时，新文件/产物默认落在当前工作目录，
 * 严禁默认写到桌面、家目录或工作目录之外的任意路径。
 */
export const OUTPUT_LOCATION_GUIDANCE =
	"\n\n**Output location**: Unless the user explicitly specifies where to save output, create any new files, generated artifacts, exports, or downloads INSIDE the current working directory shown above (use a sensible subdirectory of it when grouping helps). " +
	"NEVER default to the Desktop, the home directory, /tmp, or any path outside the current working directory. " +
	"If the user gives only a bare filename with no directory, resolve it relative to the current working directory, not the Desktop.";

/**
 * 回复语言规则。没有这条时，模型跟的是系统提示/skill 正文的语言而不是用户的语言：
 * 上下文里只要混进中文（skill 示例、工具描述），英文提问也会拿到中文的 progress、
 * todo 与正文。判定口径固定为「用户最新消息的语言」，与宿主 UI locale 无关。
 */
const RESPONSE_LANGUAGE_GUIDANCE =
	"CRITICAL — Response language: write EVERYTHING the user reads in the same language as their latest message. " +
	"This covers your prose, `progress` labels and summaries, todo items, `ask_user_question` questions/options/badges, `md_intro` text, headings, and any user-facing copy you generate inside deliverables (document text, UI labels in a design or app you build). " +
	"The language of this system prompt, of a skill's instructions, of tool descriptions, and of the app's interface is IRRELEVANT — they are written in one fixed language for maintenance reasons and are NEVER a signal about which language to answer in. " +
	"If the user writes in English, answer entirely in English even when your instructions and examples are in Chinese. Switch as soon as the user switches. " +
	"The only exceptions are identifiers you must reproduce verbatim (file paths, code, commands, quoted source text) and content the user explicitly asked for in another language.";

const FINAL_ANSWER_ORDER_GUIDANCE =
	"Before writing the final user-facing answer, complete all required tool calls and cleanup work, including validation, saving files, todo updates, and status updates. " +
	"Once you begin the final answer, do not call more tools or perform additional actions. If more work is needed, do it first, then answer.";

/** 文件名保真规则（buildGuidelines 与 custom-prompt 分支共用同一定义）。 */
const FILENAME_FIDELITY_GUIDANCE =
	"CRITICAL — File name fidelity: file names and paths are opaque byte strings — reproduce them EXACTLY as returned by tools (ls, find, dir_tree) or provided by the user; " +
	"NEVER add, remove, or change any characters including spaces, dashes, underscores, or punctuation. " +
	"When in doubt, run ls or find first to get the exact name, then copy it verbatim.";

/**
 * 桌面端渲染契约（文件徽章 / 产物块 / URL 链接）。这些是 UI 渲染约定而非模型行为指令，
 * 仅在桌面场景注入；`cli` 场景（终端无徽章/卡片渲染）剔除以省常驻 token。
 */
const FILE_LINK_GUIDANCE =
	"MANDATORY file-link format: EVERY time you mention a file you created, edited, read, or otherwise point the user at — anywhere in your prose, including headings, list items, and tables — you MUST write it as a markdown link to its ABSOLUTE path: [filename.ext](/abs/path/filename.ext). The UI turns these into clickable preview badges, so this is not optional styling. " +
	"NEVER emit a bare path as plain text, and NEVER wrap a path in backticks/inline code (`/Users/...`) when pointing the user at it — backtick paths render as dead monospace text with NO preview and cannot be clicked. Do NOT prepend file emojis like 📄 or 📁; the badge already shows a file-type icon. " +
	"Correct: Saved to [report.md](/Users/me/Desktop/report.md). Wrong: Saved to `/Users/me/Desktop/report.md` — or — Saved to 📄 report.md. " +
	"Use the exact absolute path returned by tools — never invent one; if you genuinely only have a relative path, leave it as plain text rather than fabricating an absolute one. " +
	"The only exception is paths inside fenced code blocks or shell command examples — keep those as-is.";

const DELIVERABLES_GUIDANCE =
	"If you created, edited, or wrote ANY file during this turn, the VERY LAST thing in your final message MUST be one aggregated deliverables block — this is mandatory with NO exception, even for a single file or a one-line edit; never end such a turn without it. " +
	"Format: a short heading (e.g. '产物:' / 'Deliverables:') followed by an unordered list where each item is a markdown link to the file's ABSOLUTE path — `- [filename.ext](/abs/path/filename.ext)`. " +
	"This block is the ONLY place outputs are listed (do not also scatter the same links earlier). List every file you created or changed for the user, plus user-facing outputs; exclude ONLY pure throwaway scaffolding, temp files, and files you merely read without changing. " +
	"The single case where you omit this block is a turn that changed no files at all.";

const URL_LINK_GUIDANCE =
	"Render web URLs in your prose as markdown links with descriptive text, e.g. [Vite docs](https://vitejs.dev), instead of bare URLs. Keep URLs as-is inside code blocks and shell examples.";

export interface McpToolInfo {
	name: string;
	description: string;
}

export interface BuildSystemPromptOptions {
	/** Custom system prompt (replaces default body in the legacy flow). */
	customPrompt?: string;
	/** Tools to include in prompt. Default: [read, command-tool, edit, write, dir_tree] */
	selectedTools?: string[];
	/** Text to append to system prompt. */
	appendSystemPrompt?: string;
	/** Working directory. Default: process.cwd() */
	cwd?: string;
	/** Pre-loaded context files. */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Pre-loaded skills. */
	skills?: ProductPromptSkill[];
	/** MCP tools available (from Model Context Protocol servers). */
	mcpTools?: McpToolInfo[];
	/** Pre-rendered persistent-memory block (memory-mode only, frozen snapshot). */
	memory?: string;
	/**
	 * 个性化追加块（人设 + 自定义指令，调用方已按「人设在前、自定义在后」拼好）。
	 * 拼在系统提示词末尾（date/cwd 页脚之前），recency 最高。
	 */
	personalization?: string;
	/**
	 * 工作模式专用系统提示词正文（getModePrompt 解析）。作为独立 `mode` block 注入，与 persona 正交。
	 * 空/未传 = 不追加。见 ADR-0046。
	 */
	modePrompt?: string;
	/** Runtime plugin contributions applied to the structured prompt draft before rendering. */
	agentPlugins?: AgentPluginRuntimeConfig;
	/**
	 * 当前对话场景。用于裁剪仅对 UI 渲染有意义的 guideline（文件徽章/产物块/URL 链接）：
	 * `cli` 场景剔除；未传（SDK 直调）保守保留，与旧行为一致。
	 */
	scenario?: ConversationScenario;
	/**
	 * MCP 渐进披露模式：true 时 mcpTools 是「未加载的索引」而非已激活工具，
	 * MCP 段落改为引导经 tool_search 检索激活。
	 */
	mcpDeferred?: boolean;
}

/**
 * MCP 工具的完整 description 已随请求的 tools 数组下发，这里的清单只是索引；
 * 只取首行摘要，避免长描述（如 Notion 单工具数千字符）在系统提示词里重复计费。
 */
function firstLine(text: string): string {
	const line = text.split("\n", 1)[0]?.trim() ?? "";
	return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

export function renderMcpToolsSection(mcpTools: McpToolInfo[], markdownTools: boolean, mcpDeferred = false): string {
	if (mcpTools.length === 0) {
		return "";
	}
	const toolsList = mcpTools
		.map((tool) =>
			markdownTools
				? `- **${tool.name}**: ${firstLine(tool.description)}`
				: `- ${tool.name}: ${firstLine(tool.description)}`,
		)
		.join("\n");

	const header = markdownTools
		? "# MCP (Model Context Protocol) Tools\n\nThe following MCP tools are available from external servers:"
		: "MCP (Model Context Protocol) tools:";

	const usage = mcpDeferred
		? '**MCP tool usage (deferred)**: the list above is an INDEX — these tools are not loaded into your tool list yet. Before calling one, activate it via the `tool_search` tool (keyword search over this index); activated tools stay callable for the rest of the session. Tool names are prefixed with "mcp_[servername]_". When the user explicitly asks to use a specific MCP server or tool, search for it by name and use it instead of a built-in equivalent.'
		: '**MCP tool usage**: tool names are prefixed with "mcp_[servername]_" (e.g., mcp_filesystem_list_directory). When the user explicitly asks to use a specific MCP server or tool (e.g. "use filesystem MCP to list files"), you MUST use the corresponding MCP tool instead of a built-in equivalent.';

	return `${header}

${toolsList}

${usage}`;
}

function renderContextFilesSection(contextFiles: Array<{ path: string; content: string }>): string {
	if (contextFiles.length === 0) {
		return "";
	}
	let content =
		"# Project Context\n\nProject-specific instructions and guidelines:\n\n" +
		"Scoping rules: each instruction file (AGENTS.md, CLAUDE.md, …) applies to the entire directory tree rooted at the folder that contains it. " +
		"When instructions conflict, more deeply nested files take precedence over higher-level ones, and direct user instructions in the chat always override any instruction file.\n\n";
	for (const { path: filePath, content: fileContent } of contextFiles) {
		content += `## ${filePath}\n\n${fileContent}\n\n`;
	}
	return content.trimEnd();
}

function renderFooter(dateTime: string, cwd: string): string {
	return `Current date and time: ${dateTime}
Current working directory: ${cwd}${OUTPUT_LOCATION_GUIDANCE}`;
}

function applySystemPromptContributions(draft: SystemPromptDraft, config: AgentPluginRuntimeConfig | undefined): void {
	for (const contribution of config?.systemPromptContributions ?? []) {
		const nextDraft = applySystemPromptOperations(draft, contribution.pluginId, contribution.operations);
		draft.blocks = nextDraft.blocks;
	}
}

function buildDateTime(): string {
	const now = new Date();
	return now.toLocaleString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		timeZoneName: "short",
	});
}

function buildGuidelines(tools: string[], scenario?: ConversationScenario): string {
	const guidelinesList: string[] = [];
	// 渲染契约（徽章/产物块/URL 链接）只对有 UI 渲染的场景有意义；cli 场景剔除。
	// scenario 未传（SDK 直调/测试）时保守保留，行为与旧版一致。
	const hasUiRendering = scenario !== "cli";
	const hasSelectedCommandTool = tools.includes("bash") || tools.includes("shell");
	const hasEdit = tools.includes("edit");
	const hasWrite = tools.includes("write");
	const hasGrep = tools.includes("grep");
	const hasGlob = tools.includes("glob");
	const hasFind = tools.includes("find");
	const hasLs = tools.includes("ls");
	const hasDirTree = tools.includes("dir_tree");
	const hasRead = tools.includes("read");

	if (hasSelectedCommandTool && !hasGrep && !hasGlob && !hasFind && !hasLs && !hasDirTree) {
		guidelinesList.push("Use the shell tool for file operations like ls, rg, find");
	} else if (hasSelectedCommandTool && (hasGrep || hasGlob || hasFind || hasLs || hasDirTree)) {
		guidelinesList.push(
			"Prefer grep/glob/find/ls/dir_tree tools over the shell tool for file exploration (faster, respects .gitignore)",
		);
	}

	if (hasSelectedCommandTool) {
		guidelinesList.push(
			"Before bash/shell: if the process may not exit on its own (dev server, watcher, docker compose up without -d, make dev), MUST set run_in_background: true. Foreground blocks the entire agent turn until exit (or auto-promote after the soft wait).",
		);
	}

	if (hasDirTree) {
		guidelinesList.push(
			'ALWAYS use dir_tree (not bash "tree", "ls -R", "find", "fd", or "rg --files") whenever you need to view directory structure or explore a codebase. Only fall back to bash if dir_tree cannot fulfill the specific requirement (e.g., custom output formatting)',
		);
	}

	if (tools.includes("dispatch_workflows")) {
		guidelinesList.push(
			"PARALLEL WORKFLOWS: this app can fan a complex task out to parallel workflow subagents via dispatch_workflows — each inherits a snapshot of this conversation and executes its own todo list concurrently. Proactively consider dispatching workflows whenever a task splits into independent, non-overlapping scopes (multi-module changes, batch generation, parallel research); do not wait for the user to ask. You are notified via <subagent_notification> as each finishes — after dispatching, NEVER sit in wait_agent: end your turn (or do other work) and react to notifications passively. When the user pauses workflows and later says continue, RESUME each interrupted workflow with followup_task (context and todo progress are preserved) — never re-dispatch them as new workflows.",
		);
	}

	if (tools.includes("current_time")) {
		guidelinesList.push(
			'ALWAYS use current_time tool (not bash "date", "timedatectl", or other shell commands) when you need to know the current date or time. Only fall back to bash if current_time cannot fulfill the specific requirement (e.g., timezone conversion, date arithmetic)',
		);
	}

	if (hasRead && hasEdit) {
		guidelinesList.push("Use read to examine files before editing. You must use this tool instead of cat or sed.");
	}
	if (hasEdit) {
		guidelinesList.push(
			"Use edit for precise changes. Prefer anchor mode: pass `edits` with the `line:hash` anchors from read/grep output (copy verbatim, never fabricate); the batch is atomic and stale-anchor errors return fresh anchors for immediate retry",
		);
	}
	if (hasWrite) {
		guidelinesList.push("Use write only for new files or complete rewrites");
	}
	if (hasEdit || hasWrite) {
		guidelinesList.push(
			"When summarizing your actions, output plain text directly - do NOT use cat or shell commands to display what you did",
		);
	}

	guidelinesList.push(RESPONSE_LANGUAGE_GUIDANCE);
	guidelinesList.push(FILENAME_FIDELITY_GUIDANCE);
	guidelinesList.push("Be concise in your responses");
	guidelinesList.push(FINAL_ANSWER_ORDER_GUIDANCE);
	if (hasUiRendering) {
		guidelinesList.push(FILE_LINK_GUIDANCE);
		if (hasEdit || hasWrite || hasSelectedCommandTool) {
			guidelinesList.push(DELIVERABLES_GUIDANCE);
		}
		guidelinesList.push(URL_LINK_GUIDANCE);
	}
	guidelinesList.push(
		"When the user sends images inline in their message, analyze them directly using your vision capabilities. Do NOT try to locate or read them from disk - the image data is already embedded in the message",
	);

	return guidelinesList.map((guideline) => `- ${guideline}`).join("\n");
}

function buildToolDescriptions(agentPlugins: AgentPluginRuntimeConfig | undefined): Record<string, string> {
	const descriptions = { ...toolDescriptions };
	for (const tool of agentPlugins?.toolContributions ?? []) {
		descriptions[tool.name] = tool.description;
	}
	return descriptions;
}

function resolvePromptTools(
	selectedTools: string[] | undefined,
	defaultCommandTool: string,
	toolDescriptionsByName: Record<string, string>,
): string[] {
	return (selectedTools || ["read", defaultCommandTool, "edit", "write", "dir_tree"]).filter(
		(tool) => tool in toolDescriptionsByName,
	);
}

function renderToolsList(tools: string[], toolDescriptionsByName: Record<string, string>): string {
	return tools.length > 0 ? tools.map((tool) => `- ${tool}: ${toolDescriptionsByName[tool]}`).join("\n") : "(none)";
}

/** Build the structured prompt draft with tools, guidelines, and context. */
export function buildSystemPromptDraft(options: BuildSystemPromptOptions = {}): SystemPromptDraft {
	const {
		customPrompt,
		selectedTools,
		appendSystemPrompt,
		cwd,
		contextFiles: providedContextFiles,
		skills: providedSkills,
		mcpTools: providedMcpTools,
		memory,
		personalization,
		modePrompt,
		agentPlugins,
		scenario,
		mcpDeferred,
	} = options;
	const resolvedCwd = cwd ?? process.cwd();
	const dateTime = buildDateTime();
	const defaultCommandTool = process.platform === "win32" ? "shell" : "bash";
	const contextFiles = providedContextFiles ?? [];
	const skills = providedSkills ?? [];
	const mcpTools = providedMcpTools ?? [];
	const resolvedToolDescriptions = buildToolDescriptions(agentPlugins);
	const tools = resolvePromptTools(selectedTools, defaultCommandTool, resolvedToolDescriptions);
	const toolsList = renderToolsList(tools, resolvedToolDescriptions);
	const blocks: SystemPromptBlock[] = [];

	if (customPrompt) {
		blocks.push(coreBlock("core.subconscious", "subconscious", SUBCONSCIOUS, 100));
		blocks.push(coreBlock("core.base", "base", customPrompt, 200));
		blocks.push(coreBlock("core.tools", "tools", `Available tools:\n${toolsList}`, 300));
		blocks.push(coreBlock("core.append", "append", appendSystemPrompt ?? "", 400));
		blocks.push(coreBlock("core.mcp", "mcp", renderMcpToolsSection(mcpTools, true, mcpDeferred), 500));
		blocks.push(coreBlock("core.context", "context", renderContextFilesSection(contextFiles), 600));
		blocks.push(coreBlock("core.memory", "memory", memory ?? "", 700));
		const canUseSkills = !selectedTools || selectedTools.includes("invoke_skill") || selectedTools.includes("read");
		if (canUseSkills && skills.length > 0) {
			blocks.push(coreBlock("core.skills", "skills", formatSkillsForProductPrompt(skills), 800));
		}
		blocks.push(coreBlock("core.response-language", "guidelines", RESPONSE_LANGUAGE_GUIDANCE, 890));
		blocks.push(coreBlock("core.filename-fidelity", "guidelines", FILENAME_FIDELITY_GUIDANCE, 900));
		blocks.push(coreBlock("core.final-answer-order", "guidelines", FINAL_ANSWER_ORDER_GUIDANCE, 950));
		blocks.push(coreBlock("core.mode", "mode", modePrompt ?? "", 975));
		blocks.push(coreBlock("core.personalization", "personalization", personalization ?? "", 1000));
		blocks.push(coreBlock("core.footer", "footer", renderFooter(dateTime, resolvedCwd), 1100));
		const draft: SystemPromptDraft = { blocks, metadata: { cwd: resolvedCwd, dateTime } };
		applySystemPromptContributions(draft, agentPlugins);
		return draft;
	}

	const mcpToolsSection = renderMcpToolsSection(mcpTools, false, mcpDeferred);
	const hasInvokeSkill = tools.includes("invoke_skill");
	const hasRead = tools.includes("read");

	blocks.push(coreBlock("core.subconscious", "subconscious", SUBCONSCIOUS, 100));
	blocks.push(
		coreBlock(
			"core.tools",
			"tools",
			`Available tools:\n${toolsList}${mcpToolsSection ? `\n\n${mcpToolsSection}` : ""}`,
			200,
		),
	);
	blocks.push(coreBlock("core.guidelines", "guidelines", `Guidelines:\n${buildGuidelines(tools, scenario)}\n`, 300));
	blocks.push(coreBlock("core.append", "append", appendSystemPrompt ?? "", 400));
	blocks.push(coreBlock("core.context", "context", renderContextFilesSection(contextFiles), 500));
	blocks.push(coreBlock("core.memory", "memory", memory ?? "", 600));
	if ((hasRead || hasInvokeSkill) && skills.length > 0) {
		blocks.push(coreBlock("core.skills", "skills", formatSkillsForProductPrompt(skills), 700));
	}
	blocks.push(coreBlock("core.mode", "mode", modePrompt ?? "", 850));
	blocks.push(coreBlock("core.personalization", "personalization", personalization ?? "", 900));
	blocks.push(coreBlock("core.footer", "footer", renderFooter(dateTime, resolvedCwd), 1000));

	const draft: SystemPromptDraft = { blocks, metadata: { cwd: resolvedCwd, dateTime } };
	applySystemPromptContributions(draft, agentPlugins);
	return draft;
}

/** Build the system prompt with tools, guidelines, and context. */
export function buildSystemPrompt(options: BuildSystemPromptOptions = {}): string {
	return renderSystemPromptDraft(buildSystemPromptDraft(options));
}
