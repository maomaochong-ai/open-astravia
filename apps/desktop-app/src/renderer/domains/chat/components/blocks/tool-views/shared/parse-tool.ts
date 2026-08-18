import { i18n } from "@shared/i18n";
import { languageAtom, pluginAgentToolLabelsAtom, pluginI18nByIdAtom, type ToolCallBlock } from "@shared/store/atoms";
import { resolvePluginText } from "@vetta-org/plugin-sdk";
import { getDefaultStore } from "jotai";
import { shortenPath } from "./format";

/** Parse MCP tool name: mcp_serverName_toolName */
export function parseMcpTool(name: string): { server: string; tool: string } | null {
	const match = name.match(/^mcp_([^_]+)_(.+)$/);
	return match ? { server: match[1], tool: match[2] } : null;
}

export function getShellCommand(block: ToolCallBlock): string | null {
	if (block.toolName !== "bash" && block.toolName !== "shell") return null;
	const cmd = block.args.command;
	return typeof cmd === "string" ? cmd : null;
}

export function getStringArg(args: Record<string, unknown>, key: string): string | null {
	const value = args[key];
	return typeof value === "string" ? value : null;
}

function getToolCallDescription(args: Record<string, unknown>): string {
	const description = args.description;
	return typeof description === "string" ? description.trim() : "";
}

/**
 * Resolve a plugin-registered tool UI label (supports `%catalogKey%`).
 * Returns null when no plugin registered a label for this tool name.
 */
function resolvePluginToolLabel(name: string): string | null {
	const store = getDefaultStore();
	const registered = store.get(pluginAgentToolLabelsAtom)[name];
	if (!registered?.label) return null;
	const entry = store.get(pluginI18nByIdAtom)[registered.pluginId];
	const locale = store.get(languageAtom);
	const resolved = resolvePluginText(registered.label, entry?.locales ?? {}, locale, entry?.defaultLocale ?? "zh");
	return resolved.trim().length > 0 ? resolved : null;
}

/**
 * 系统工具名对普通用户不可读（`invoke_skill`、`edit`…），映射到语义别名。
 * 优先用插件 `registerTool({ label })`（含 `%key%` 插件 i18n）；否则回退宿主
 * `chat:toolLabel.alias.*`；都没有则原样返回技术名。
 * 只替换工具名本身；agent 写的 description / 参数 detail 照旧拼在后面。
 */
export function toolAlias(name: string): string {
	const fromPlugin = resolvePluginToolLabel(name);
	if (fromPlugin) return fromPlugin;
	return i18n.t(`chat:toolLabel.alias.${name}`, { defaultValue: name });
}

/** Get icon for tool */
export function toolIcon(name: string): string {
	if (name.startsWith("mcp_")) return "icon-[mdi--cloud-outline]";
	switch (name) {
		case "read":
			return "icon-[mdi--file-document-outline]";
		case "write":
			return "icon-[mdi--file-edit-outline]";
		case "edit":
			return "icon-[mdi--file-replace-outline]";
		case "bash":
		case "shell":
			return "icon-[mdi--console]";
		case "ls":
		case "find":
		case "dir_tree":
		case "tree":
			return "icon-[mdi--folder-search-outline]";
		case "grep":
			return "icon-[mdi--text-search]";
		case "ask_user_question":
			return "icon-[mdi--comment-question-outline]";
		case "easy_use_vettaApp":
			return "icon-[mdi--application-cog-outline]";
		case "kb_write_page":
			return "icon-[mdi--book-edit-outline]";
		case "kb_filter_by_tags":
			return "icon-[mdi--tag-search-outline]";
		case "kb_list_available_tags":
			return "icon-[mdi--tag-multiple-outline]";
		default:
			return "icon-[mdi--wrench-outline]";
	}
}

/**
 * Format the tool header label.
 * @param aliased Work 模式传 true：用 i18n 语义别名替换系统工具名（`invoke_skill`→执行技能）。
 *   coding 模式保持原始工具名。
 */
export function toolLabel(block: ToolCallBlock, aliased = false): { name: string; detail: string } {
	const mcp = parseMcpTool(block.toolName);
	const args = block.args;

	if (mcp) {
		const path = args.path || args.uri || args.url || args.file_path;
		return {
			name: mcp.tool,
			detail: path ? shortenPath(String(path)) : "",
		};
	}

	const name = block.toolName;
	let displayName = aliased ? toolAlias(name) : name;
	let detail = "";
	const description = getToolCallDescription(args);

	if (name === "read" || name === "write" || name === "edit") {
		const path = args.file_path ?? args.path;
		if (typeof path === "string") detail = shortenPath(path);
		if (name === "edit" && block.uiDetails?.firstChangedLine !== undefined) {
			detail += `:${block.uiDetails.firstChangedLine}`;
		}
	} else if (name === "bash" || name === "shell") {
		const cmd = args.command;
		if (typeof cmd === "string") detail = cmd.length > 80 ? `${cmd.slice(0, 77)}...` : cmd;
	} else if (name === "grep") {
		const pattern = args.pattern;
		if (typeof pattern === "string") detail = `/${pattern}/`;
	} else if (name === "find" || name === "ls" || name === "dir_tree" || name === "tree") {
		const path = args.path ?? args.pattern;
		if (typeof path === "string") detail = shortenPath(path);
		else if (name === "dir_tree" || name === "tree") detail = ".";
	} else if (name === "extract_text_from_img" || name === "extract_text_from_pdf" || name === "html_to_pdf") {
		const input = args.input;
		if (typeof input === "string") detail = shortenPath(input);
	} else if (name === "render_pdf_page") {
		const input = args.input;
		if (typeof input === "string") {
			detail = shortenPath(input);
			if (typeof args.page === "number") detail += `:p${args.page}`;
		}
	} else if (name === "doc_to_pdf") {
		const path = args.path;
		if (typeof path === "string") detail = shortenPath(path);
	} else if (name === "ask_user_question") {
		const questions = args.questions;
		if (Array.isArray(questions) && questions.length > 0) {
			const first = questions[0] as { header?: unknown; question?: unknown };
			const head =
				typeof first.header === "string" ? first.header : typeof first.question === "string" ? first.question : "";
			detail = questions.length > 1 ? `${head} +${questions.length - 1}` : head;
		}
	} else if (name === "easy_use_vettaApp") {
		const actionId = args.actionId;
		if (typeof actionId === "string") detail = actionId;
	} else if (name === "kb_write_page") {
		displayName = i18n.t("chat:toolLabel.knowledgeBase.writePage");
		const title = args.title ?? args.path;
		if (typeof title === "string") detail = title;
	} else if (name === "kb_filter_by_tags") {
		displayName = i18n.t("chat:toolLabel.knowledgeBase.filterByTags");
		const parts: string[] = [];
		for (const key of ["all", "any", "none"] as const) {
			const tags = args[key];
			if (Array.isArray(tags) && tags.length > 0) {
				const op = key === "all" ? "且" : key === "any" ? "或" : "非";
				parts.push(`${op} ${tags.filter((t) => typeof t === "string").join("/")}`);
			}
		}
		detail = parts.join("，");
	} else if (name === "kb_list_available_tags") {
		displayName = i18n.t("chat:toolLabel.knowledgeBase.listTags");
	} else if (name === "todo") {
		const action = args.action;
		if (typeof action === "string") {
			detail = action;
			if (action === "update") {
				if (typeof args.id === "number") detail += ` #${args.id}`;
				if (typeof args.status === "string") detail += ` → ${args.status}`;
			} else if (action === "create" && Array.isArray(args.items)) {
				detail += ` (${args.items.length})`;
			}
		}
	}

	return { name: displayName, detail: description ? [description, detail].filter(Boolean).join(" · ") : detail };
}

export function truncateFirstLine(cmd: string, maxLen = 40): string {
	const first = cmd.split("\n")[0] ?? "";
	return first.length > maxLen ? `${first.slice(0, maxLen - 1)}…` : first;
}

export function bashHeaderLabel(status: ToolCallBlock["status"], cmd: string): string {
	const short = truncateFirstLine(cmd);
	if (status === "pending") return i18n.t("chat:bashHeader.statusPending", { short });
	if (status === "error") return i18n.t("chat:bashHeader.statusError", { short });
	return i18n.t("chat:bashHeader.statusSuccess", { short });
}
