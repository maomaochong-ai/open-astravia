import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { yaml } from "@codemirror/lang-yaml";
import type { Extension } from "@codemirror/state";

export function getTextEditorLanguageExtension(extension: string): Extension {
	switch (extension) {
		case "ts":
			return javascript({ typescript: true });
		case "tsx":
			return javascript({ typescript: true, jsx: true });
		case "js":
		case "mjs":
		case "cjs":
			return javascript();
		case "jsx":
			return javascript({ jsx: true });
		case "json":
			return json();
		case "html":
		case "htm":
			return html();
		case "css":
		case "scss":
		case "less":
			return css();
		case "md":
		case "mdx":
			return markdown();
		case "py":
			return python();
		case "yaml":
		case "yml":
			return yaml();
		default:
			return [];
	}
}
