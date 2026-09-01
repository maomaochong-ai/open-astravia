import { recordInputFilesAdded } from "@shared/lib/app-monitor-events";
import { isImagePath } from "@shared/lib/input-tokens";
import { pathBasename } from "@shared/lib/utils";
import type { MentionedFile } from "@shared/store/atoms";
import type { FilePreviewContext, FilePreviewItem } from "@shared/store/file-preview-atoms";
import { useCallback } from "react";
import { focusInputEditor, insertFileToken, insertImageToken, removeImageToken } from "./editor/inputEditorHandle";
import { persistBase64Images } from "./editor/persistImages";

async function readFileSize(path: string): Promise<number | undefined> {
	const stat = await window.vetta.fs.stat(path).catch(() => null);
	return stat && stat.size > 0 ? stat.size : undefined;
}

export function useInputBarAttachmentModel({
	activeRuntimeId,
	effectiveCwd,
	hasSession,
	imageAttachments,
	setAppshotAttachment,
	setFilePreview,
	setInputValue,
	setMentionedFiles,
	setPendingMessageEdit,
	setPromptAttachment,
}: {
	activeRuntimeId?: string;
	effectiveCwd: string;
	hasSession: boolean;
	imageAttachments: ReadonlyArray<{ path: string; name: string; url: string }>;
	setAppshotAttachment: (value: null) => void;
	setFilePreview: (value: FilePreviewItem | FilePreviewContext | null) => void;
	setInputValue: (value: string) => void;
	setMentionedFiles: (value: MentionedFile[]) => void;
	setPendingMessageEdit: (value: null) => void;
	setPromptAttachment: (value: null) => void;
}) {
	const handleSelectImages = useCallback(async () => {
		if (!hasSession) return;
		const selected = await window.vetta.dialog.selectImages();
		const paths = await persistBase64Images(selected, activeRuntimeId ?? null, "image-dialog");
		for (const path of paths) insertImageToken(path);
		focusInputEditor();
	}, [activeRuntimeId, hasSession]);

	const handleSelectFiles = useCallback(async () => {
		if (!hasSession) return;
		const paths = await window.vetta.dialog.selectFiles(effectiveCwd || undefined);
		const additions: Array<{ path: string; name: string; isDirectory: false; sizeBytes?: number }> = [];
		for (const path of paths) {
			if (isImagePath(path)) insertImageToken(path);
			else insertFileToken(path, false);
			const sizeBytes = await readFileSize(path);
			additions.push({
				path,
				name: pathBasename(path),
				isDirectory: false,
				...(sizeBytes === undefined ? {} : { sizeBytes }),
			});
		}
		if (additions.length > 0) recordInputFilesAdded("file-dialog", additions);
		focusInputEditor();
	}, [effectiveCwd, hasSession]);

	const openImagePreview = useCallback(
		(index: number) => setFilePreview({ items: [...imageAttachments], index }),
		[imageAttachments, setFilePreview],
	);
	const removeImage = useCallback((path: string) => {
		removeImageToken(path);
		focusInputEditor();
	}, []);
	const removePromptAttachment = useCallback(() => setPromptAttachment(null), [setPromptAttachment]);
	const removeAppshot = useCallback(() => setAppshotAttachment(null), [setAppshotAttachment]);
	const cancelPendingEdit = useCallback(() => {
		setPendingMessageEdit(null);
		setInputValue("");
		setMentionedFiles([]);
		setAppshotAttachment(null);
	}, [setAppshotAttachment, setInputValue, setMentionedFiles, setPendingMessageEdit]);

	return {
		cancelPendingEdit,
		handleSelectFiles,
		handleSelectImages,
		openImagePreview,
		removeAppshot,
		removeImage,
		removePromptAttachment,
	};
}
