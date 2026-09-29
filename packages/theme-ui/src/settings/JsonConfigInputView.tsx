import { json } from "@codemirror/lang-json";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, placeholder as editorPlaceholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { minimalSetup } from "codemirror";
import { useEffect, useRef, type JSX } from "react";

const jsonConfigHighlightStyle = HighlightStyle.define([
	{
		tag: [tags.propertyName, tags.definition(tags.propertyName)],
		color: "var(--foreground)",
		fontWeight: "500",
	},
	{
		tag: [tags.string, tags.number, tags.bool, tags.null],
		color: "color-mix(in srgb, var(--foreground) 82%, var(--primary))",
	},
	{
		tag: [tags.punctuation, tags.brace, tags.squareBracket, tags.separator],
		color: "color-mix(in srgb, var(--muted-foreground) 78%, transparent)",
	},
]);

const jsonConfigInputTheme = EditorView.theme({
	"&": {
		height: "100%",
		color: "var(--foreground)",
		backgroundColor: "transparent",
		fontSize: "13px",
	},
	"&.cm-focused": {
		outline: "none",
	},
	".cm-scroller": {
		overflow: "auto",
		overscrollBehavior: "contain",
		fontFamily: "var(--font-sans)",
		lineHeight: "1.55",
	},
	".cm-content": {
		minHeight: "100%",
		padding: "10px 12px",
		caretColor: "var(--primary)",
	},
	".cm-line": {
		padding: "0",
	},
	".cm-placeholder": {
		color: "color-mix(in srgb, var(--muted-foreground) 40%, transparent)",
		fontStyle: "normal",
	},
	".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
		backgroundColor: "color-mix(in srgb, var(--primary) 15%, transparent) !important",
	},
	".cm-cursor, .cm-dropCursor": {
		borderLeftColor: "var(--primary)",
	},
});

export interface JsonConfigInputViewProps {
	readonly value: string;
	readonly onValueChange: (value: string) => void;
	readonly placeholder: string;
	readonly ariaLabel: string;
	readonly ariaInvalid?: boolean;
	readonly ariaDescribedBy?: string;
}

/** A restrained, theme-aware JSON field without IDE chrome or editor-only tools. */
export function JsonConfigInputView({
	value,
	onValueChange,
	placeholder,
	ariaLabel,
	ariaInvalid = false,
	ariaDescribedBy,
}: JsonConfigInputViewProps): JSX.Element {
	const hostRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const onValueChangeRef = useRef(onValueChange);
	const applyingExternalValueRef = useRef(false);
	const initialValueRef = useRef(value);
	const initialPlaceholderRef = useRef(placeholder);
	const initialAccessibilityRef = useRef({ ariaLabel, ariaInvalid, ariaDescribedBy });
	const accessibilityCompartmentRef = useRef(new Compartment());
	const placeholderCompartmentRef = useRef(new Compartment());
	onValueChangeRef.current = onValueChange;

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;

		const initialAccessibility = initialAccessibilityRef.current;
		const accessibilityAttributes: Record<string, string> = {
			"aria-label": initialAccessibility.ariaLabel,
			"aria-invalid": String(initialAccessibility.ariaInvalid),
			spellcheck: "false",
			autocapitalize: "off",
			autocomplete: "off",
		};
		if (initialAccessibility.ariaDescribedBy) {
			accessibilityAttributes["aria-describedby"] = initialAccessibility.ariaDescribedBy;
		}

		const state = EditorState.create({
			doc: initialValueRef.current,
			extensions: [
				minimalSetup,
				json(),
				EditorView.lineWrapping,
				jsonConfigInputTheme,
				syntaxHighlighting(jsonConfigHighlightStyle),
				accessibilityCompartmentRef.current.of(EditorView.contentAttributes.of(accessibilityAttributes)),
				placeholderCompartmentRef.current.of(editorPlaceholder(initialPlaceholderRef.current)),
				EditorView.updateListener.of((update) => {
					if (update.docChanged && !applyingExternalValueRef.current) {
						onValueChangeRef.current(update.state.doc.toString());
					}
				}),
			],
		});
		const view = new EditorView({ state, parent: host });
		viewRef.current = view;

		return () => {
			view.destroy();
			viewRef.current = null;
		};
	}, []);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		const currentValue = view.state.doc.toString();
		if (currentValue === value) return;
		applyingExternalValueRef.current = true;
		try {
			view.dispatch({ changes: { from: 0, to: currentValue.length, insert: value } });
		} finally {
			applyingExternalValueRef.current = false;
		}
	}, [value]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		const accessibilityAttributes: Record<string, string> = {
			"aria-label": ariaLabel,
			"aria-invalid": String(ariaInvalid),
			spellcheck: "false",
			autocapitalize: "off",
			autocomplete: "off",
		};
		if (ariaDescribedBy) accessibilityAttributes["aria-describedby"] = ariaDescribedBy;
		view.dispatch({
			effects: [
				accessibilityCompartmentRef.current.reconfigure(EditorView.contentAttributes.of(accessibilityAttributes)),
				placeholderCompartmentRef.current.reconfigure(editorPlaceholder(placeholder)),
			],
		});
	}, [ariaDescribedBy, ariaInvalid, ariaLabel, placeholder]);

	return (
		<div
			ref={hostRef}
			data-invalid={ariaInvalid ? "true" : "false"}
			className="h-72 min-h-40 w-full resize-y overflow-hidden rounded-lg border border-input bg-card text-foreground transition-colors focus-within:border-ring data-[invalid=true]:border-destructive"
		/>
	);
}
