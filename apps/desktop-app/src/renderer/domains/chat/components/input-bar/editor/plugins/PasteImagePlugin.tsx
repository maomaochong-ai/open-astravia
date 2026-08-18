import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { activeSessionAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { COMMAND_PRIORITY_CRITICAL, PASTE_COMMAND } from "lexical";
import { useEffect } from "react";
import { insertImageToken } from "../inputEditorHandle";
import { persistImageFiles } from "../persistImages";

function clipboardImages(event: ClipboardEvent): File[] {
	const items = Array.from(event.clipboardData?.items ?? []);
	return items
		.filter((item) => item.kind === "file" && item.type.startsWith("image/"))
		.map((item) => item.getAsFile())
		.filter((file): file is File => file !== null);
}

/**
 * 粘贴图片 → 立即落盘 → 插入行内缩略图 token。
 * 只在剪贴板里确实有图片时接管，纯文本粘贴仍走 Lexical 默认实现。
 */
export function PasteImagePlugin(): null {
	const [editor] = useLexicalComposerContext();
	const activeSession = useAtomValue(activeSessionAtom);

	useEffect(() => {
		return editor.registerCommand(
			PASTE_COMMAND,
			(event) => {
				if (!(event instanceof ClipboardEvent)) return false;
				const files = clipboardImages(event);
				if (files.length === 0) return false;
				event.preventDefault();
				void persistImageFiles(files, activeSession?.runtimeId ?? null, "paste").then((paths) => {
					for (const path of paths) insertImageToken(path);
				});
				return true;
			},
			COMMAND_PRIORITY_CRITICAL,
		);
	}, [activeSession?.runtimeId, editor]);

	return null;
}
