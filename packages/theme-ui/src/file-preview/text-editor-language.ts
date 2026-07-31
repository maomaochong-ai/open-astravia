import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import type { Extension } from "@codemirror/state";

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
		case "scss":
		case "less":
			return css();
		case "markdown":
			return markdown();
		case "python":
			return python();
		case "yaml":
			return yaml();
		default:
			return [];
	}
}
