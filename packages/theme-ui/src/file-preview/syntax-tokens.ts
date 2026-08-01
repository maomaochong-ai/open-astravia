/**
 * Syntax highlight tokens for the file text editor (CodeMirror).
 *
 * Design:
 * - Colors are CSS custom properties (`--syntax-*`), so any host theme can override
 *   a subset without touching CodeMirror code.
 * - Defaults (VS Code Dark+ / Light+) live in host CSS (`:root` / `[data-mode="light"]`).
 * - HighlightStyle only references `var(--syntax-…)`; changing theme mode updates live.
 *
 * Theme authors: set any of {@link SYNTAX_TOKEN_CSS_VARS} on `:root`, `[data-mode]`,
 * or `[data-theme="…"]`. Unset tokens fall back to the host defaults.
 */

export const SYNTAX_TOKEN_CSS_VARS = {
	/** Line / block comments */
	comment: "--syntax-comment",
	/** Language keywords (import, return, const, …) */
	keyword: "--syntax-keyword",
	/** Control-flow keywords (if, else, for, while, …) */
	keywordControl: "--syntax-keyword-control",
	/** Storage / definition keywords (class, function, type, …) */
	storage: "--syntax-storage",
	/** String literals */
	string: "--syntax-string",
	/** Numbers */
	number: "--syntax-number",
	/** Boolean / null / undefined atoms */
	bool: "--syntax-bool",
	/** Regular expressions */
	regexp: "--syntax-regexp",
	/** Type names, interfaces, type params */
	type: "--syntax-type",
	/** Class names */
	className: "--syntax-class",
	/** Function / method names */
	function: "--syntax-function",
	/** Variables */
	variable: "--syntax-variable",
	/** Constants / enum members */
	constant: "--syntax-constant",
	/** Object / struct properties */
	property: "--syntax-property",
	/** Function parameters */
	parameter: "--syntax-parameter",
	/** Operators (+, ===, =>, …) */
	operator: "--syntax-operator",
	/** Punctuation and brackets */
	punctuation: "--syntax-punctuation",
	/** HTML/XML/JSX tag names */
	tag: "--syntax-tag",
	/** HTML/XML/JSX attribute names */
	attribute: "--syntax-attribute",
	/** Attribute values */
	attributeValue: "--syntax-attribute-value",
	/** Angle brackets around tags: < > </> */
	angle: "--syntax-angle",
	/** Meta / preprocessor / annotations / doctype */
	meta: "--syntax-meta",
	/** Escape sequences inside strings */
	escape: "--syntax-escape",
	/** Links (markdown / urls) */
	link: "--syntax-link",
	/** Markdown headings */
	heading: "--syntax-heading",
	/** Invalid / error tokens */
	invalid: "--syntax-invalid",
	/** Diff inserted */
	inserted: "--syntax-inserted",
	/** Diff deleted */
	deleted: "--syntax-deleted",
} as const;

export type SyntaxTokenId = keyof typeof SYNTAX_TOKEN_CSS_VARS;

/** Ordered list of token ids — useful for docs / theme pickers. */
export const SYNTAX_TOKEN_IDS = Object.keys(SYNTAX_TOKEN_CSS_VARS) as SyntaxTokenId[];

export function syntaxVar(token: SyntaxTokenId): string {
	return `var(${SYNTAX_TOKEN_CSS_VARS[token]})`;
}

/**
 * VS Code Dark+ inspired defaults (dark_vs / dark_plus).
 * Hosts should inject these under `:root` / `[data-mode="dark"]`.
 */
export const SYNTAX_PALETTE_VSCODE_DARK: Record<SyntaxTokenId, string> = {
	comment: "#6A9955",
	keyword: "#569CD6",
	keywordControl: "#C586C0",
	storage: "#569CD6",
	string: "#CE9178",
	number: "#B5CEA8",
	bool: "#569CD6",
	regexp: "#D16969",
	type: "#4EC9B0",
	className: "#4EC9B0",
	function: "#DCDCAA",
	variable: "#9CDCFE",
	constant: "#4FC1FF",
	property: "#9CDCFE",
	parameter: "#9CDCFE",
	operator: "#D4D4D4",
	punctuation: "#D4D4D4",
	tag: "#569CD6",
	attribute: "#9CDCFE",
	attributeValue: "#CE9178",
	angle: "#808080",
	meta: "#569CD6",
	escape: "#D7BA7D",
	link: "#3794FF",
	heading: "#569CD6",
	invalid: "#F44747",
	inserted: "#B5CEA8",
	deleted: "#F44747",
};

/**
 * VS Code Light+ inspired defaults (light_vs / light_plus).
 * Hosts should inject these under `[data-mode="light"]`.
 */
export const SYNTAX_PALETTE_VSCODE_LIGHT: Record<SyntaxTokenId, string> = {
	comment: "#008000",
	keyword: "#0000FF",
	keywordControl: "#AF00DB",
	storage: "#0000FF",
	string: "#A31515",
	number: "#098658",
	bool: "#0000FF",
	regexp: "#811F3F",
	type: "#267F99",
	className: "#267F99",
	function: "#795E26",
	variable: "#001080",
	constant: "#0070C1",
	property: "#001080",
	parameter: "#001080",
	operator: "#000000",
	punctuation: "#000000",
	tag: "#800000",
	attribute: "#E50000",
	attributeValue: "#0000FF",
	angle: "#800000",
	meta: "#0000FF",
	escape: "#EE0000",
	link: "#0000FF",
	heading: "#800000",
	invalid: "#CD3131",
	inserted: "#098658",
	deleted: "#CD3131",
};

/** Serialize a palette to CSS custom-property declarations (no surrounding block). */
export function syntaxPaletteToCssDeclarations(palette: Record<SyntaxTokenId, string>): string {
	return SYNTAX_TOKEN_IDS.map((id) => `\t${SYNTAX_TOKEN_CSS_VARS[id]}: ${palette[id]};`).join("\n");
}
