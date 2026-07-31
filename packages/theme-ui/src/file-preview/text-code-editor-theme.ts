import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

const textEditorHighlightStyle = HighlightStyle.define([
	{
		tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
		color: "color-mix(in srgb, var(--muted-foreground) 78%, transparent)",
		fontStyle: "italic",
	},
	{
		tag: [
			tags.keyword,
			tags.modifier,
			tags.operatorKeyword,
			tags.controlKeyword,
			tags.definitionKeyword,
			tags.moduleKeyword,
			tags.self,
		],
		color: "var(--primary)",
	},
	{
		tag: [tags.string, tags.docString, tags.character, tags.attributeValue, tags.regexp],
		color: "color-mix(in srgb, var(--primary) 58%, var(--foreground))",
	},
	{
		tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null, tags.atom, tags.unit],
		color: "color-mix(in srgb, var(--primary) 78%, var(--foreground))",
	},
	{
		tag: [tags.typeName, tags.className, tags.namespace, tags.tagName],
		color: "color-mix(in srgb, var(--primary) 68%, var(--foreground))",
		fontWeight: "500",
	},
	{
		tag: [
			tags.function(tags.variableName),
			tags.function(tags.propertyName),
			tags.definition(tags.function(tags.variableName)),
		],
		color: "color-mix(in srgb, var(--primary) 48%, var(--foreground))",
		fontWeight: "500",
	},
	{
		tag: [tags.propertyName, tags.attributeName, tags.labelName, tags.macroName],
		color: "color-mix(in srgb, var(--foreground) 82%, var(--primary))",
	},
	{
		tag: [tags.operator, tags.punctuation, tags.bracket, tags.separator],
		color: "color-mix(in srgb, var(--muted-foreground) 82%, var(--foreground))",
	},
	{
		tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3],
		color: "var(--primary)",
		fontWeight: "600",
	},
	{
		tag: tags.link,
		color: "var(--primary)",
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
		tag: [tags.meta, tags.annotation, tags.processingInstruction],
		color: "var(--muted-foreground)",
	},
	{
		tag: [tags.invalid, tags.deleted],
		color: "var(--destructive)",
		textDecoration: "underline",
		textDecorationColor: "color-mix(in srgb, var(--destructive) 70%, transparent)",
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
