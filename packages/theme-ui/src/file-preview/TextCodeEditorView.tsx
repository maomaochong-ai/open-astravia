import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef, type JSX } from "react";
import { textCodeEditorTheme } from "./text-code-editor-theme";
import { getTextEditorLanguageExtension } from "./text-editor-language";

export interface TextCodeEditorViewProps {
	documentKey: string;
	initialValue: string;
	extension: string;
	lineEnding: "lf" | "crlf";
	onChange: (content: string) => void;
}

export function TextCodeEditorView({
	documentKey,
	initialValue,
	extension,
	lineEnding,
	onChange,
}: TextCodeEditorViewProps): JSX.Element {
	const hostRef = useRef<HTMLDivElement>(null);
	const initialValueRef = useRef(initialValue);
	const onChangeRef = useRef(onChange);
	initialValueRef.current = initialValue;
	onChangeRef.current = onChange;

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const state = EditorState.create({
			doc: initialValueRef.current,
			extensions: [
				basicSetup,
				EditorState.lineSeparator.of(lineEnding === "crlf" ? "\r\n" : "\n"),
				getTextEditorLanguageExtension(extension),
				textCodeEditorTheme,
				EditorView.updateListener.of((update) => {
					if (update.docChanged) onChangeRef.current(update.state.doc.toString());
				}),
			],
		});
		const view = new EditorView({ state, parent: host });
		view.focus();
		return () => view.destroy();
	}, [documentKey, extension, lineEnding]);

	return <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden bg-background" />;
}
