import { type ShortcutBinding, useShortcutScope } from "@shared/shortcuts";
import { type FilePreviewItem, filePreviewContextReadonlyAtom } from "@shared/store/atoms";
import { useAtom } from "jotai";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { FilePreviewDialogViewProps } from "../components/FilePreviewDialogView";
import { usePreviewNav } from "../components/FilePreviewView";
import { downloadItem, getExtension, IMAGE_EXTENSIONS } from "../components/PreviewContent";

function isImage(item: FilePreviewItem): boolean {
	return IMAGE_EXTENSIONS.has(getExtension(item.name));
}

export type FilePreviewDialogModel = FilePreviewDialogViewProps;

export function useFilePreviewDialogModel(): FilePreviewDialogModel {
	const { t } = useTranslation("common");
	const [ctx, setCtx] = useAtom(filePreviewContextReadonlyAtom);
	const { goPrev, goNext, close } = usePreviewNav(setCtx);

	const item = ctx ? (ctx.items[ctx.index] ?? null) : null;
	const isImageGroup = !!ctx && ctx.items.length > 1 && ctx.items.every(isImage);

	const bindings = useMemo((): ShortcutBinding[] => {
		const list: ShortcutBinding[] = [{ key: "escape", run: () => close() }];
		if (isImageGroup) {
			list.push({ key: "arrowleft", run: () => goPrev() }, { key: "arrowright", run: () => goNext() });
		}
		return list;
	}, [isImageGroup, close, goPrev, goNext]);

	useShortcutScope({
		id: "surface:file-preview-dialog",
		kind: "surface",
		active: item != null,
		exclusive: false,
		bindings,
	});

	const selectIndex = useCallback((index: number) => setCtx((prev) => (prev ? { ...prev, index } : prev)), [setCtx]);

	return {
		context: ctx,
		isImageGroup,
		item,
		labels: {
			close: t("filePreview.close"),
			download: t("filePreview.download"),
			showInFolder: t("filePreview.showInFolder"),
		},
		onClose: close,
		onDownload: (previewItem) => void downloadItem(previewItem),
		onGoNext: goNext,
		onGoPrev: goPrev,
		onSelectIndex: selectIndex,
		onShowInFolder: (path) => void window.vetta.shell.showItemInFolder(path),
	};
}
