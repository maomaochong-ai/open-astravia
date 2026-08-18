import { knowledgeImportDraftAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useCallback, useRef } from "react";

/** 把选中/拖入的文件转为磁盘绝对路径列表（平铺导入，不再做智能整理）。 */
function filesToPaths(files: FileList): string[] {
	return Array.from(files)
		.map((file) => window.vetta.fs.pathForFile(file))
		.filter(Boolean);
}

export function useKnowledgeImportSources() {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const setDraft = useSetAtom(knowledgeImportDraftAtom);

	const openFilePicker = useCallback((targetKnowledgeBaseId: string | null) => {
		if (!fileInputRef.current) return;
		fileInputRef.current.dataset.targetKnowledgeBaseId = targetKnowledgeBaseId ?? "";
		fileInputRef.current.click();
	}, []);

	const openFolderPicker = useCallback(
		async (targetKnowledgeBaseId: string | null) => {
			const paths = await window.vetta.dialog.selectFolders();
			if (paths.length === 0) return;
			setDraft({ sourcePaths: paths, defaultTargetId: targetKnowledgeBaseId });
		},
		[setDraft],
	);

	const onFilesPicked = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const paths = event.target.files ? filesToPaths(event.target.files) : [];
			const targetKnowledgeBaseId = event.target.dataset.targetKnowledgeBaseId || null;
			event.target.value = "";
			if (paths.length === 0) return;
			setDraft({ sourcePaths: paths, defaultTargetId: targetKnowledgeBaseId });
		},
		[setDraft],
	);

	return { fileInputRef, openFilePicker, openFolderPicker, onFilesPicked };
}
