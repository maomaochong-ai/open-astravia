import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { syntaxVar } from "./syntax-tokens";

/**
 * CodeMirror highlight mapping → `--syntax-*` CSS variables.
 * Covers common programming + markup + markdown tokens (VS Code–like roles).
 * Colors themselves are not hard-coded here; themes own the palette.
 */
const textEditorHighlightStyle = HighlightStyle.define([
	// ── Comments ──────────────────────────────────────────────
	{
		tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
		color: syntaxVar("comment"),
		fontStyle: "italic",
	},

	// ── Keywords ──────────────────────────────────────────────
	{
		tag: [tags.controlKeyword, tags.controlOperator],
		color: syntaxVar("keywordControl"),
		fontWeight: "500",
	},
	{
		tag: [tags.definitionKeyword, tags.moduleKeyword, tags.modifier],
		color: syntaxVar("storage"),
		fontWeight: "500",
	},
	{
		tag: [tags.keyword, tags.operatorKeyword, tags.self],
		color: syntaxVar("keyword"),
		fontWeight: "500",
	},

	// ── Literals ──────────────────────────────────────────────
	{
		tag: [tags.string, tags.docString, tags.character, tags.special(tags.string)],
		color: syntaxVar("string"),
	},
	{
		tag: [tags.attributeValue],
		color: syntaxVar("attributeValue"),
	},
	{
		tag: [tags.number, tags.integer, tags.float, tags.unit],
		color: syntaxVar("number"),
	},
	{
		tag: [tags.bool, tags.null, tags.atom],
		color: syntaxVar("bool"),
	},
	{
		tag: [tags.regexp],
		color: syntaxVar("regexp"),
	},
	{
		tag: [tags.escape],
		color: syntaxVar("escape"),
	},

	// ── Names ─────────────────────────────────────────────────
	{
		tag: [tags.tagName, tags.documentMeta],
		color: syntaxVar("tag"),
	},
	{
		tag: [tags.typeName, tags.standard(tags.typeName)],
		color: syntaxVar("type"),
	},
	{
		tag: [tags.className, tags.namespace],
		color: syntaxVar("className"),
	},
	{
		tag: [
			tags.function(tags.variableName),
			tags.function(tags.propertyName),
			tags.definition(tags.function(tags.variableName)),
			tags.definition(tags.function(tags.propertyName)),
		],
		color: syntaxVar("function"),
	},
	{
		tag: [tags.attributeName],
		color: syntaxVar("attribute"),
	},
	{
		tag: [tags.constant(tags.variableName), tags.standard(tags.variableName), tags.literal],
		color: syntaxVar("constant"),
	},
	{
		tag: [tags.definition(tags.propertyName), tags.propertyName, tags.labelName, tags.macroName],
		color: syntaxVar("property"),
	},
	{
		tag: [tags.special(tags.variableName), tags.local(tags.variableName)],
		color: syntaxVar("parameter"),
	},
	{
		tag: [tags.variableName, tags.definition(tags.variableName)],
		color: syntaxVar("variable"),
	},

	// ── Markup / structure ────────────────────────────────────
	{
		tag: [tags.angleBracket],
		color: syntaxVar("angle"),
	},
	{
		tag: [
			tags.operator,
			tags.derefOperator,
			tags.compareOperator,
			tags.arithmeticOperator,
			tags.logicOperator,
			tags.bitwiseOperator,
			tags.definitionOperator,
			tags.updateOperator,
		],
		color: syntaxVar("operator"),
	},
	{
		tag: [tags.punctuation, tags.bracket, tags.separator, tags.squareBracket, tags.paren, tags.brace],
		color: syntaxVar("punctuation"),
	},
	{
		tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6],
		color: syntaxVar("heading"),
		fontWeight: "600",
	},
	{
		tag: [tags.link, tags.url],
		color: syntaxVar("link"),
		textDecoration: "underline",
		textUnderlineOffset: "2px",
	},
	{
		tag: tags.emphasis,
		fontStyle: "italic",
	},
	{
		tag: tags.strong,
		fontWeight: "600",
	},
	{
		tag: tags.strikethrough,
		textDecoration: "line-through",
	},
	{
		tag: [tags.meta, tags.annotation, tags.processingInstruction, tags.contentSeparator],
		color: syntaxVar("meta"),
	},

	// ── Diagnostics / diff ────────────────────────────────────
	{
		tag: [tags.invalid],
		color: syntaxVar("invalid"),
		textDecoration: "underline",
	},
	{
		tag: [tags.inserted],
		color: syntaxVar("inserted"),
	},
	{
		tag: [tags.deleted],
		color: syntaxVar("deleted"),
		textDecoration: "line-through",
	},
]);

const textEditorChromeTheme = EditorView.theme({
	"&": {
		height: "100%",
		color: "var(--foreground)",
		backgroundColor: "var(--background)",
		fontSize: "13px",
	},
	"&.cm-focused": {
		outline: "none",
	},
	".cm-scroller": {
		overflow: "auto",
		overscrollBehavior: "contain",
		fontFamily: "var(--font-mono)",
		lineHeight: "1.55",
	},
	".cm-content": {
		minHeight: "100%",
		caretColor: "var(--primary)",
		padding: "10px 0 24px",
	},
	".cm-line": {
		padding: "0 14px 0 10px",
	},
	".cm-gutters": {
		color: "color-mix(in srgb, var(--muted-foreground) 72%, transparent)",
		backgroundColor: "color-mix(in srgb, var(--background) 88%, var(--muted))",
		borderRight: "1px solid color-mix(in srgb, var(--border) 55%, transparent)",
	},
	".cm-lineNumbers .cm-gutterElement": {
		minWidth: "40px",
		padding: "0 9px 0 6px",
	},
	".cm-activeLine": {
		backgroundColor: "color-mix(in srgb, var(--primary) 6%, transparent)",
	},
	".cm-activeLineGutter": {
		color: "var(--foreground)",
		backgroundColor: "color-mix(in srgb, var(--primary) 8%, transparent)",
	},
	".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
		backgroundColor: "color-mix(in srgb, var(--primary) 15%, transparent) !important",
	},
	".cm-selectionMatch": {
		backgroundColor: "color-mix(in srgb, var(--primary) 10%, transparent)",
	},
	".cm-cursor, .cm-dropCursor": {
		borderLeftColor: "var(--primary)",
	},
	".cm-fat-cursor": {
		color: "var(--background)",
		backgroundColor: "var(--primary)",
	},
	".cm-matchingBracket": {
		color: "var(--foreground)",
		backgroundColor: "color-mix(in srgb, var(--primary) 14%, transparent)",
		outline: "1px solid color-mix(in srgb, var(--primary) 40%, transparent)",
	},
	".cm-nonmatchingBracket": {
		color: "var(--destructive)",
		backgroundColor: "color-mix(in srgb, var(--destructive) 10%, transparent)",
	},
	".cm-searchMatch": {
		backgroundColor: "color-mix(in srgb, var(--primary) 14%, transparent)",
		outline: "1px solid color-mix(in srgb, var(--primary) 35%, transparent)",
	},
	".cm-searchMatch.cm-searchMatch-selected": {
		backgroundColor: "color-mix(in srgb, var(--primary) 24%, transparent)",
	},
	".cm-panels": {
		color: "var(--foreground)",
		backgroundColor: "var(--card)",
	},
	".cm-panels.cm-panels-top": {
		borderBottom: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
	},
	".cm-panels.cm-panels-bottom": {
		borderTop: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
	},
	".cm-panel": {
		padding: "6px 8px",
		fontFamily: "var(--font-sans)",
		fontSize: "12px",
	},
	".cm-panel.cm-search": {
		gap: "6px",
	},
	".cm-textfield": {
		height: "28px",
		color: "var(--foreground)",
		backgroundColor: "var(--input)",
		border: "1px solid var(--border)",
		borderRadius: "var(--radius-md)",
		padding: "0 8px",
		fontFamily: "var(--font-sans)",
		outline: "none",
	},
	".cm-textfield:focus": {
		borderColor: "var(--primary)",
		outline: "1px solid color-mix(in srgb, var(--primary) 25%, transparent)",
	},
	".cm-button": {
		height: "28px",
		color: "var(--foreground)",
		backgroundColor: "var(--secondary)",
		backgroundImage: "none",
		border: "1px solid var(--border)",
		borderRadius: "var(--radius-md)",
		padding: "0 9px",
		fontFamily: "var(--font-sans)",
		fontSize: "12px",
	},
	".cm-button:hover": {
		backgroundColor: "var(--accent)",
	},
	".cm-tooltip": {
		color: "var(--popover-foreground)",
		backgroundColor: "var(--popover)",
		border: "1px solid color-mix(in srgb, var(--border) 65%, transparent)",
		borderRadius: "var(--radius-lg)",
		boxShadow: "var(--shadow-md)",
		overflow: "hidden",
	},
	".cm-tooltip-autocomplete > ul": {
		fontFamily: "var(--font-sans)",
		fontSize: "12px",
	},
	".cm-tooltip-autocomplete > ul > li": {
		minHeight: "26px",
		padding: "4px 8px",
	},
	".cm-tooltip-autocomplete > ul > li[aria-selected]": {
		color: "var(--foreground)",
		backgroundColor: "color-mix(in srgb, var(--primary) 12%, transparent)",
	},
	".cm-completionIcon": {
		color: "var(--primary)",
		opacity: "0.85",
	},
	".cm-foldPlaceholder": {
		color: "var(--muted-foreground)",
		backgroundColor: "var(--muted)",
		border: "1px solid var(--border)",
		borderRadius: "var(--radius-sm)",
		padding: "0 5px",
	},
});

export const textCodeEditorTheme: Extension = [textEditorChromeTheme, syntaxHighlighting(textEditorHighlightStyle)];
