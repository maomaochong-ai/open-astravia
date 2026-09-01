import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";
import { setInputEditor } from "../inputEditorHandle";

/** 把编辑器实例登记到模块级 handle；共享编辑器负责同步只读态。 */
export function EditorHandlePlugin(): null {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		setInputEditor(editor);
		return () => setInputEditor(null);
	}, [editor]);
	return null;
}
