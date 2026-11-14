import { updaterRestartDialogOpenAtom, updaterStateAtom } from "@shared/store/atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

export interface SidebarUpdateButtonModel {
	label: string;
	/** 下载中：图标换成进度提示，点击不做事。 */
	downloading: boolean;
	onOpen: () => void;
}

/**
 * 只在有更新要处理时返回 model，其余阶段返回 null，图标不出现：
 * available 点击开始下载，downloading 只显示进度，ready 点开更新对话框。
 * 侧栏底部空间很小，一整个更新条常驻会压过用户自己的内容，因此这里只留一个图标。
 */
export function useSidebarUpdateButtonModel(): SidebarUpdateButtonModel | null {
	const { t } = useTranslation("project");
	const state = useAtomValue(updaterStateAtom);
	const openDialog = useSetAtom(updaterRestartDialogOpenAtom);

	const onOpen = useCallback(() => {
		if (state.phase === "available") {
			void window.astravia.updater.download();
			return;
		}
		if (state.phase === "ready") openDialog(true);
	}, [openDialog, state.phase]);

	const version = state.latestVersion ?? "";
	const percent = Math.round((state.progress ?? 0) * 100);

	if (state.phase === "available") {
		return { label: t("update.bannerAvailable", { version }), downloading: false, onOpen };
	}
	if (state.phase === "downloading") {
		return { label: t("update.bannerDownloading", { percent }), downloading: true, onOpen };
	}
	if (state.phase !== "ready") return null;
	return { label: t("update.bannerReady", { version }), downloading: false, onOpen };
}
