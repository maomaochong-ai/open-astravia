import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { type StreamParser as LanguageStreamParser, StreamLanguage } from "@codemirror/language";
import { c, clike, cpp, csharp, dart, java, kotlin } from "@codemirror/legacy-modes/mode/clike";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { go } from "@codemirror/legacy-modes/mode/go";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { r } from "@codemirror/legacy-modes/mode/r";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { sass } from "@codemirror/legacy-modes/mode/sass";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import type { Extension } from "@codemirror/state";

/**
 * legacy-modes 的 StreamParser 来自 @codemirror/streamparser，
 * 与 @codemirror/language 中 StreamLanguage.define 期望的 StreamParser
 * 是两份独立声明（私有字段 tabSize 导致名义不兼容）。
 * 集中在此做一次收窄转换，避免在每个调用点重复断言。
 */
function legacyLang(parser: unknown): Extension {
	// legacy-modes 的解析器来自 @codemirror/streamparser，与 @codemirror/language
	// 中的 StreamParser 是两份独立声明（私有字段 tabSize 导致名义不兼容），集中在此转换。
	return StreamLanguage.define(parser as LanguageStreamParser<unknown>);
}

/**
 * Normalize a bare extension or filename/path to a lowercase extension without a leading dot.
 * Prefer the last path segment so directory dots do not affect the result.
 */
export function normalizeFileExtension(nameOrExtension: string): string {
	const trimmed = nameOrExtension.trim();
	if (!trimmed) return "";
	const base = trimmed.replace(/\\/g, "/").split("/").pop() ?? trimmed;
	const bare = base.startsWith(".") && !base.includes(".", 1) ? base.slice(1) : base;
	const dotIdx = bare.lastIndexOf(".");
	if (dotIdx <= 0) {
		// bare extension like "html" or "Dockerfile"
		return bare.toLowerCase();
	}
	return bare.slice(dotIdx + 1).toLowerCase();
}

/**
 * Map file extension → Shiki / display language id.
 * Shared by the CodeMirror editor and readonly CodePreview so formats stay aligned.
 */
export function getTextEditorLanguageId(extension: string): string {
	const ext = normalizeFileExtension(extension);
	switch (ext) {
		case "ts":
		case "mts":
		case "cts":
			return "typescript";
		case "tsx":
			return "tsx";
		case "js":
		case "mjs":
		case "cjs":
			return "javascript";
		case "jsx":
			return "jsx";
		case "json":
		case "jsonc":
		case "json5":
			return "json";
		case "html":
		case "htm":
		case "xhtml":
		case "vue":
		case "svelte":
		case "astro":
			return "html";
		case "xml":
		case "xsd":
		case "xsl":
		case "xslt":
		case "svg":
		case "plist":
			return "xml";
		case "css":
			return "css";
		case "scss":
			return "scss";
		case "less":
			return "less";
		case "md":
		case "mdx":
		case "markdown":
			return "markdown";
		case "py":
		case "pyi":
		case "pyw":
			return "python";
		case "yaml":
		case "yml":
			return "yaml";
		case "toml":
			return "toml";
		case "go":
			return "go";
		case "rs":
			return "rust";
		case "java":
			return "java";
		case "kt":
		case "kts":
			return "kotlin";
		case "swift":
			return "swift";
		case "rb":
			return "ruby";
		case "php":
			return "php";
		case "c":
		case "h":
			return "c";
		case "cpp":
		case "cc":
		case "cxx":
		case "hpp":
		case "hh":
			return "cpp";
		case "cs":
			return "c#";
		case "sh":
		case "bash":
		case "zsh":
		case "fish":
			return "bash";
		case "sql":
			return "sql";
		case "graphql":
		case "gql":
			return "graphql";
		case "lua":
			return "lua";
		case "r":
			return "r";
		case "dart":
			return "dart";
		case "dockerfile":
			return "dockerfile";
		case "makefile":
		case "mk":
			return "makefile";
		case "env":
			return "dotenv";
		case "ini":
		case "cfg":
		case "conf":
		case "properties":
			return "ini";
		case "log":
		case "txt":
		case "lock":
			return "text";
		default:
			return ext || "text";
	}
}

/**
 * CodeMirror language support for the editable text preview.
 * Falls back to plain text (empty extension) when no dedicated grammar is available.
 */
export function getTextEditorLanguageExtension(extension: string): Extension {
	const langId = getTextEditorLanguageId(extension);
	switch (langId) {
		case "typescript":
			return javascript({ typescript: true });
		case "tsx":
			return javascript({ typescript: true, jsx: true });
		case "javascript":
			return javascript();
		case "jsx":
			return javascript({ jsx: true });
		case "json":
			return json();
		case "html":
			// Nested CSS/JS highlighting is enabled by default in @codemirror/lang-html.
			return html({ autoCloseTags: true });
		case "xml":
			return xml();
		case "css":
			return css();
		case "scss":
		case "less":
			return legacyLang(sass);
		case "markdown":
			return markdown();
		case "python":
			return python();
		case "yaml":
			return yaml();
		case "toml":
			return legacyLang(toml);
		case "go":
			return legacyLang(go);
		case "rust":
			return legacyLang(rust);
		case "java":
			return legacyLang(java);
		case "kotlin":
			return legacyLang(kotlin);
		case "swift":
			return legacyLang(swift);
		case "ruby":
			return legacyLang(ruby);
		case "php":
			// legacy-modes 没有 php 专用解析器，clike 可覆盖其主要语法结构
			return legacyLang(clike({ name: "php" }));
		case "c":
			return legacyLang(c);
		case "cpp":
			return legacyLang(cpp);
		case "c#":
			return legacyLang(csharp);
		case "bash":
			return legacyLang(shell);
		case "sql":
			return legacyLang(standardSQL);
		case "graphql":
			// legacy-modes 没有 graphql，用 clike 近似高亮关键字与字符串
			return legacyLang(clike({ name: "graphql" }));
		case "lua":
			return legacyLang(lua);
		case "r":
			return legacyLang(r);
		case "dart":
			return legacyLang(dart);
		case "dockerfile":
			return legacyLang(dockerFile);
		case "makefile":
			// legacy-modes 没有 makefile，用 shell 近似（变量、目标、命令行）
			return legacyLang(shell);
		case "dotenv":
		case "ini":
			return legacyLang(properties);
		default:
			return [];
	}
}
