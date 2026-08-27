import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { activeSessionAtom } from "@shared/store/atoms";
import { recordInputImagesAdded } from "@shared/lib/app-monitor-events";
import { useAtomValue } from "jotai";
import { COMMAND_PRIORITY_CRITICAL, PASTE_COMMAND } from "lexical";
import { useEffect } from "react";
import { insertClipboardMessage } from "../clipboard-message";
import { persistBase64Images, persistImageFiles } from "../persistImages";
import {
	type ClipboardImages,
	readClipboardImageFiles,
	readClipboardImages,
} from "./clipboard-images";

/**
 * 粘贴图片 → 立即落盘 → 插入行内缩略图 token。Vetta 富消息剪贴板还会
 * 恢复正文并用新落盘路径替换旧图片 token；纯文本仍走 Lexical 默认实现。
 */
export function PasteImagePlugin(): null {
	const [editor] = useLexicalComposerContext();
	const activeSession = useAtomValue(activeSessionAtom);

	useEffect(() => {
		const persistClipboardImages = (clipboardImages: ClipboardImages): void => {
			const persist =
				clipboardImages.kind === "vetta-message"
					? persistBase64Images(clipboardImages.images, activeSession?.runtimeId ?? null, "paste")
					: persistImageFiles(clipboardImages.files, activeSession?.runtimeId ?? null, "paste");
			void persist.then((paths) => {
				if (clipboardImages.kind === "vetta-message") {
					insertClipboardMessage(clipboardImages.messageText, paths);
				} else {
					insertClipboardMessage("", paths);
				}
			});
		};

		return editor.registerCommand(
			PASTE_COMMAND,
			(event) => {
				if (!("clipboardData" in event) || !event.clipboardData) return false;
				const nativeImageFiles = readClipboardImageFiles(event.clipboardData);
				if (nativeImageFiles.length > 0) {
					event.preventDefault();
					void window.vetta.clipboard
						.pasteUserMessage(activeSession?.runtimeId ?? "draft")
						.catch((error: unknown) => {
							console.warn("[input-editor] rich clipboard paste failed:", error);
							return null;
						})
						.then((richMessage) => {
							if (!richMessage) {
								persistClipboardImages({ kind: "files", files: nativeImageFiles });
								return;
							}
							recordInputImagesAdded("paste", richMessage.images);
							insertClipboardMessage(
								richMessage.text,
								richMessage.images.map((image) => image.path),
							);
						});
					return true;
				}
				const clipboardImages = readClipboardImages(event.clipboardData);
				const hasImages =
					clipboardImages.kind === "vetta-message"
						? clipboardImages.images.length > 0
						: clipboardImages.files.length > 0;
				if (!hasImages) return false;
				event.preventDefault();
				persistClipboardImages(clipboardImages);
				return true;
			},
			COMMAND_PRIORITY_CRITICAL,
		);
	}, [activeSession?.runtimeId, editor]);

	return null;
}
