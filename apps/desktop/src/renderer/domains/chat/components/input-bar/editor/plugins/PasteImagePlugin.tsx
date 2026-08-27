import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { activeSessionAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { COMMAND_PRIORITY_CRITICAL, PASTE_COMMAND } from "lexical";
import { useEffect } from "react";
import { insertClipboardMessage } from "../clipboard-message";
import { insertImageToken } from "../inputEditorHandle";
import { persistImageFiles } from "../persistImages";
import { readClipboardImages } from "./clipboard-images";

/**
 * 粘贴图片 → 立即落盘 → 插入行内缩略图 token。Vetta 富消息剪贴板还会
 * 恢复正文并用新落盘路径替换旧图片 token；纯文本仍走 Lexical 默认实现。
 */
export function PasteImagePlugin(): null {
	const [editor] = useLexicalComposerContext();
	const activeSession = useAtomValue(activeSessionAtom);

	useEffect(() => {
		return editor.registerCommand(
			PASTE_COMMAND,
			(event) => {
				if (!("clipboardData" in event) || !event.clipboardData) return false;
				const { files, messageText } = readClipboardImages(event.clipboardData);
				if (files.length === 0) return false;
				event.preventDefault();
				void persistImageFiles(files, activeSession?.runtimeId ?? null, "paste").then((paths) => {
					if (messageText !== undefined) insertClipboardMessage(messageText, paths);
					else for (const path of paths) insertImageToken(path);
				});
				return true;
			},
			COMMAND_PRIORITY_CRITICAL,
		);
	}, [activeSession?.runtimeId, editor]);

	return null;
}
