import { FILE_EDITOR_SAVE_EVENT } from "@/shared/shortcuts";
import { FS_EDITABLE_TEXT_ERROR } from "@/preload/fs-types";
import {
	getExtension,
	TextFileEditorView,
	type FilePreviewItem,
	type TextFileEditorMode,
	type TextFileEditorViewState,
} from "@vetta/theme-ui/file-preview";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTextFileEditor } from "../hooks/useTextFileEditor";
import { TextPreviewRenderer } from "./TextPreviewRenderer";

export function EditableTextFileView({
	item,
	refreshNonce,
}: {
	item: FilePreviewItem & { path: string };
	refreshNonce: number;
}): JSX.Element {
	const { t } = useTranslation("chat");
	const [mode, setMode] = useState<TextFileEditorMode>("edit");
	const model = useTextFileEditor(item.path, refreshNonce);
	const extension = getExtension(item.name);
	const { document } = model;

	useEffect(() => {
		setMode("edit");
	}, [item.path]);

	useEffect(() => {
		const handleSave = () => void model.save();
		window.addEventListener(FILE_EDITOR_SAVE_EVENT, handleSave);
		return () => window.removeEventListener(FILE_EDITOR_SAVE_EVENT, handleSave);
	}, [model.save]);

	const getErrorText = (error: unknown): string => {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes(FS_EDITABLE_TEXT_ERROR.TOO_LARGE)) return t("fileEditor.errorTooLarge");
		if (message.includes(FS_EDITABLE_TEXT_ERROR.NOT_UTF8)) return t("fileEditor.errorNotUtf8");
		return t("fileEditor.errorRead");
	};

	let state: TextFileEditorViewState;
	if (!document) {
		state =
			model.loadStatus === "error"
				? { status: "error", message: getErrorText(model.loadError) }
				: { status: "loading" };
	} else {
		state = {
			status: "ready",
			mode,
			statusLabel: model.saving
				? t("fileEditor.saving")
				: model.dirty
					? t("fileEditor.unsaved")
					: t("fileEditor.saved"),
			dirty: model.dirty,
			saving: model.saving,
			hasConflict: Boolean(document.conflictRevision),
			conflictMessage: t("fileEditor.conflict"),
			inlineError: model.saveError
				? t("fileEditor.errorSave")
				: model.loadStatus === "error"
					? getErrorText(model.loadError)
					: undefined,
			documentKey: `${item.path}:${document.revision}`,
			content: document.draftContent,
			extension,
			lineEnding: document.lineEnding,
			previewContent: <TextPreviewRenderer content={document.draftContent} extension={extension} />,
		};
	}

	return (
		<TextFileEditorView
			state={state}
			labels={{
				loading: t("fileEditor.loading"),
				edit: t("fileEditor.edit"),
				preview: t("fileEditor.preview"),
				save: t("fileEditor.save"),
				reload: t("fileEditor.reload"),
				overwrite: t("fileEditor.overwrite"),
			}}
			onModeChange={setMode}
			onChange={model.updateDraft}
			onSave={() => void model.save()}
			onReload={() => void model.reloadFromDisk()}
			onOverwrite={() => void model.save(true)}
		/>
	);
}
