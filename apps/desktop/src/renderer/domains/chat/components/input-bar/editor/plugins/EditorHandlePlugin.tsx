import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";
import { setInputEditor } from "../inputEditorHandle";

export interface EditorHandlePluginProps {
	editable: boolean;
}

/** 把编辑器实例登记到模块级 handle，并同步只读态（无会话 / 生成中）。 */
export function EditorHandlePlugin({ editable }: EditorHandlePluginProps): null {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		setInputEditor(editor);
		return () => setInputEditor(null);
	}, [editor]);

	useEffect(() => {
		editor.setEditable(editable);
	}, [editable, editor]);

	return null;
}
