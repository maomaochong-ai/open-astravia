export {
	type AskUserQuestionAnswer,
	type AskUserQuestionCapability,
	type AskUserQuestionFn,
	type AskUserQuestionItem,
	type AskUserQuestionOption,
	type AskUserQuestionRequest,
	type AskUserQuestionResult,
	type AskUserQuestionToolDetails,
	type AskUserQuestionToolInput,
	type AskUserQuestionToolOptions,
	createAskUserQuestionTool,
} from "./ask-user-question/index.js";
export {
	type BashOperations,
	type BashSpawnContext,
	type BashSpawnHook,
	type BashToolDetails,
	type BashToolInput,
	type BashToolOptions,
	bashTool,
	CODING_AGENT_SESSION_ID_ENV,
	createBashTool,
	createSessionCommandEnvironment,
} from "./bash/index.js";
export {
	type CurrentTimeToolDetails,
	type CurrentTimeToolInput,
	createCurrentTimeTool,
	currentTimeTool,
} from "./current-time/index.js";
export {
	createDocToPdfTool,
	type DocToPdfOperations,
	type DocToPdfToolInput,
	type DocToPdfToolOptions,
	docToPdfTool,
} from "./doc-to-pdf/index.js";
export {
	createEditTool,
	type EditOperations,
	type EditToolDetails,
	type EditToolInput,
	type EditToolOptions,
	editTool,
} from "./edit/index.js";
export {
	createExtractTextFromImgTool,
	type ExtractTextFromImgToolInput,
	extractTextFromImgTool,
} from "./extract-text-from-img/index.js";
export {
	createExtractTextFromPdfTool,
	type ExtractTextFromPdfToolInput,
	extractTextFromPdfTool,
} from "./extract-text-from-pdf/index.js";
export {
	createFindTool,
	type FindOperations,
	type FindToolDetails,
	type FindToolInput,
	type FindToolOptions,
	findTool,
} from "./find/index.js";
export {
	createGlobTool,
	type GlobOperations,
	type GlobToolDetails,
	type GlobToolInput,
	type GlobToolOptions,
	globTool,
} from "./glob/index.js";
export {
	createGrepTool,
	type GrepOperations,
	type GrepToolDetails,
	type GrepToolInput,
	type GrepToolOptions,
	grepTool,
} from "./grep/index.js";
export {
	createHtmlToPdfTool,
	type HtmlToPdfToolInput,
	htmlToPdfTool,
} from "./html-to-pdf/index.js";
export {
	createImSendAttachmentTool,
	type ImHostBridge,
	type ImSendAttachmentToolDetails,
} from "./im-send-attachment/index.js";
export {
	createInvokeSkillTool,
	type InvokeSkillToolDetails,
	type InvokeSkillToolInput,
	type InvokeSkillToolOptions,
} from "./invoke-skill/index.js";
export {
	createKbFilterByTagsTool,
	type KbFilterByTagsDetails,
	type KbFilterByTagsInput,
	kbFilterByTagsTool,
} from "./kb-filter-by-tags/index.js";
export {
	createKbListTagsTool,
	type KbListTagsDetails,
	type KbListTagsInput,
	kbListTagsTool,
} from "./kb-list-tags/index.js";
export {
	createKbWritePageTool,
	type KbWritePageDetails,
	type KbWritePageInput,
	kbWritePageTool,
} from "./kb-write-page/index.js";
export {
	createLsTool,
	type LsOperations,
	type LsToolDetails,
	type LsToolInput,
	type LsToolOptions,
	lsTool,
} from "./ls/index.js";
export { createMemoryTool, type MemoryToolDetails } from "./memory/index.js";
export {
	createProgressTool,
	type ProgressToolDetails,
	type ProgressToolInput,
	progressTool,
} from "./progress/index.js";
export {
	createReadTool,
	type ReadOperations,
	type ReadToolDetails,
	type ReadToolInput,
	type ReadToolOptions,
	readTool,
} from "./read/index.js";
export {
	createRenderPdfPageTool,
	type RenderPdfPageToolInput,
	renderPdfPageTool,
} from "./render-pdf-page/index.js";
export {
	createShellTool,
	type ShellOperations,
	type ShellSpawnContext,
	type ShellSpawnHook,
	type ShellToolDetails,
	type ShellToolInput,
	type ShellToolOptions,
	shellTool,
} from "./shell/index.js";
export {
	createTaskOutputTool,
	type TaskOutputToolDetails,
	type TaskOutputToolInput,
	type TaskOutputToolOptions,
} from "./task-output/index.js";
export {
	createTaskStopTool,
	type TaskStopToolDetails,
	type TaskStopToolInput,
	type TaskStopToolOptions,
} from "./task-stop/index.js";
export { createTodoTool, type TodoToolDetails, type TodoToolOptions } from "./todo/index.js";
export {
	createToolSearchTool,
	type DeferredToolIndexEntry,
	scoreDeferredTools,
	type ToolSearchResult,
	type ToolSearchToolDetails,
	type ToolSearchToolInput,
	type ToolSearchToolOptions,
} from "./tool-search/index.js";
export {
	createTreeTool,
	type TreeOperations,
	type TreeToolDetails,
	type TreeToolInput,
	type TreeToolOptions,
	treeTool,
} from "./tree/index.js";
export {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
} from "./truncate.js";
export {
	createWriteTool,
	type WriteOperations,
	type WriteToolInput,
	type WriteToolOptions,
	writeTool,
} from "./write/index.js";

import type { AgentTool } from "@astravia/agent-core";
import { type BashToolOptions, bashTool, createBashTool } from "./bash/index.js";
import { createCurrentTimeTool, currentTimeTool } from "./current-time/index.js";
import { createDocToPdfTool, type DocToPdfToolOptions, docToPdfTool } from "./doc-to-pdf/index.js";
import { createEditTool, editTool } from "./edit/index.js";
import { createExtractTextFromImgTool, extractTextFromImgTool } from "./extract-text-from-img/index.js";
import { createExtractTextFromPdfTool, extractTextFromPdfTool } from "./extract-text-from-pdf/index.js";
import { createFindTool, findTool } from "./find/index.js";
import { createGlobTool, type GlobToolOptions, globTool } from "./glob/index.js";
import { createGrepTool, grepTool } from "./grep/index.js";
import { createHtmlToPdfTool, htmlToPdfTool } from "./html-to-pdf/index.js";
import { createKbFilterByTagsTool, kbFilterByTagsTool } from "./kb-filter-by-tags/index.js";
import { createKbListTagsTool, kbListTagsTool } from "./kb-list-tags/index.js";
import { createKbWritePageTool, kbWritePageTool } from "./kb-write-page/index.js";
import { createLsTool, lsTool } from "./ls/index.js";
import { createProgressTool, progressTool } from "./progress/index.js";
import { createReadTool, type ReadToolOptions, readTool } from "./read/index.js";
import { createRenderPdfPageTool, renderPdfPageTool } from "./render-pdf-page/index.js";
import { createShellTool, type ShellToolOptions, shellTool } from "./shell/index.js";
import { createTreeTool, treeTool } from "./tree/index.js";
import { createWriteTool, writeTool } from "./write/index.js";

/** Tool type (AgentTool from pi-ai) */
export type Tool = AgentTool<any>;

export type CommandToolName = "bash" | "shell";

export function getDefaultCommandToolName(): CommandToolName {
	return process.platform === "win32" ? "shell" : "bash";
}

export function getDefaultCodingToolNames(): ["read", CommandToolName, "edit", "write", "grep", "glob", "dir_tree"] {
	return ["read", getDefaultCommandToolName(), "edit", "write", "grep", "glob", "dir_tree"];
}

// Default tools for full access mode (using process.cwd())
const defaultCommandToolName = getDefaultCommandToolName();
const defaultCommandTool = defaultCommandToolName === "shell" ? shellTool : bashTool;
export const codingTools: Tool[] = [
	readTool,
	defaultCommandTool,
	editTool,
	writeTool,
	grepTool,
	globTool,
	treeTool,
	docToPdfTool,
	htmlToPdfTool,
	extractTextFromPdfTool,
	extractTextFromImgTool,
	renderPdfPageTool,
];

// Read-only tools for exploration without modification (using process.cwd())
export const readOnlyTools: Tool[] = [readTool, grepTool, globTool, findTool, lsTool, treeTool];

// All available tools (using process.cwd())
export const allTools = {
	read: readTool,
	bash: bashTool,
	shell: shellTool,
	edit: editTool,
	write: writeTool,
	grep: grepTool,
	glob: globTool,
	find: findTool,
	ls: lsTool,
	dir_tree: treeTool,
	doc_to_pdf: docToPdfTool,
	html_to_pdf: htmlToPdfTool,
	extract_text_from_pdf: extractTextFromPdfTool,
	extract_text_from_img: extractTextFromImgTool,
	render_pdf_page: renderPdfPageTool,
	current_time: currentTimeTool,
	progress: progressTool,
	kb_write_page: kbWritePageTool,
	kb_filter_by_tags: kbFilterByTagsTool,
	kb_list_available_tags: kbListTagsTool,
};

export type ToolName = keyof typeof allTools;

export interface ToolsOptions {
	/** Options for the read tool */
	read?: ReadToolOptions;
	/** Options for the bash tool */
	bash?: BashToolOptions;
	/** Options for the shell tool */
	shell?: ShellToolOptions;
	/** Options for the doc-to-pdf tool */
	docToPdf?: DocToPdfToolOptions;
	/** Options for the glob tool */
	glob?: GlobToolOptions;
}

/**
 * Create coding tools configured for a specific working directory.
 */
export function createCodingTools(cwd: string, options?: ToolsOptions): Tool[] {
	const commandTool =
		getDefaultCommandToolName() === "shell"
			? createShellTool(cwd, options?.shell ?? options?.bash)
			: createBashTool(cwd, options?.bash ?? options?.shell);

	return [
		createReadTool(cwd, options?.read),
		commandTool,
		createEditTool(cwd),
		createWriteTool(cwd),
		createGrepTool(cwd),
		createGlobTool(cwd, options?.glob),
		createTreeTool(cwd),
		createDocToPdfTool(cwd, options?.docToPdf),
		createHtmlToPdfTool(cwd),
		createExtractTextFromPdfTool(cwd),
		createExtractTextFromImgTool(cwd),
		createRenderPdfPageTool(cwd),
	];
}

/**
 * Create read-only tools configured for a specific working directory.
 */
export function createReadOnlyTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, options?.read),
		createGrepTool(cwd),
		createGlobTool(cwd, options?.glob),
		createFindTool(cwd),
		createLsTool(cwd),
		createTreeTool(cwd),
	];
}

/**
 * Create all tools configured for a specific working directory.
 */
export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, Tool> {
	return {
		read: createReadTool(cwd, options?.read),
		bash: createBashTool(cwd, options?.bash),
		shell: createShellTool(cwd, options?.shell ?? options?.bash),
		edit: createEditTool(cwd),
		write: createWriteTool(cwd),
		grep: createGrepTool(cwd),
		glob: createGlobTool(cwd, options?.glob),
		find: createFindTool(cwd),
		ls: createLsTool(cwd),
		dir_tree: createTreeTool(cwd),
		doc_to_pdf: createDocToPdfTool(cwd, options?.docToPdf),
		html_to_pdf: createHtmlToPdfTool(cwd),
		extract_text_from_pdf: createExtractTextFromPdfTool(cwd),
		extract_text_from_img: createExtractTextFromImgTool(cwd),
		render_pdf_page: createRenderPdfPageTool(cwd),
		current_time: createCurrentTimeTool(),
		progress: createProgressTool(),
		kb_write_page: createKbWritePageTool(),
		kb_filter_by_tags: createKbFilterByTagsTool(),
		kb_list_available_tags: createKbListTagsTool(),
	};
}
