import { highlight, supportsLanguage } from "cli-highlight";
import type { Theme } from "./theme.js";
import { theme } from "./theme-state.js";

type CliHighlightTheme = Record<string, (value: string) => string>;

let cachedTheme: Theme | undefined;
let cachedHighlightTheme: CliHighlightTheme | undefined;

function getHighlightTheme(activeTheme: Theme): CliHighlightTheme {
	if (cachedTheme !== activeTheme || !cachedHighlightTheme) {
		cachedTheme = activeTheme;
		cachedHighlightTheme = {
			keyword: (value) => activeTheme.fg("syntaxKeyword", value),
			built_in: (value) => activeTheme.fg("syntaxType", value),
			literal: (value) => activeTheme.fg("syntaxNumber", value),
			number: (value) => activeTheme.fg("syntaxNumber", value),
			string: (value) => activeTheme.fg("syntaxString", value),
			comment: (value) => activeTheme.fg("syntaxComment", value),
			function: (value) => activeTheme.fg("syntaxFunction", value),
			title: (value) => activeTheme.fg("syntaxFunction", value),
			class: (value) => activeTheme.fg("syntaxType", value),
			type: (value) => activeTheme.fg("syntaxType", value),
			attr: (value) => activeTheme.fg("syntaxVariable", value),
			variable: (value) => activeTheme.fg("syntaxVariable", value),
			params: (value) => activeTheme.fg("syntaxVariable", value),
			operator: (value) => activeTheme.fg("syntaxOperator", value),
			punctuation: (value) => activeTheme.fg("syntaxPunctuation", value),
		};
	}
	return cachedHighlightTheme;
}

export function highlightCode(code: string, language?: string): string[] {
	const supportedLanguage = language && supportsLanguage(language) ? language : undefined;
	try {
		return highlight(code, {
			language: supportedLanguage,
			ignoreIllegals: true,
			theme: getHighlightTheme(theme),
		}).split("\n");
	} catch {
		return code.split("\n");
	}
}

export function getLanguageFromPath(filePath: string): string | undefined {
	const extension = filePath.split(".").pop()?.toLowerCase();
	if (!extension) return undefined;
	return LANGUAGE_BY_EXTENSION[extension];
}

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
	ts: "typescript",
	tsx: "typescript",
	js: "javascript",
	jsx: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	py: "python",
	rb: "ruby",
	rs: "rust",
	go: "go",
	java: "java",
	kt: "kotlin",
	swift: "swift",
	c: "c",
	h: "c",
	cpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	hpp: "cpp",
	cs: "csharp",
	php: "php",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	fish: "fish",
	ps1: "powershell",
	sql: "sql",
	html: "html",
	htm: "html",
	css: "css",
	scss: "scss",
	sass: "sass",
	less: "less",
	json: "json",
	yaml: "yaml",
	yml: "yaml",
	toml: "toml",
	xml: "xml",
	md: "markdown",
	markdown: "markdown",
	dockerfile: "dockerfile",
	makefile: "makefile",
	cmake: "cmake",
	lua: "lua",
	perl: "perl",
	r: "r",
	scala: "scala",
	clj: "clojure",
	ex: "elixir",
	exs: "elixir",
	erl: "erlang",
	hs: "haskell",
	ml: "ocaml",
	vim: "vim",
	graphql: "graphql",
	proto: "protobuf",
	tf: "hcl",
	hcl: "hcl",
};
