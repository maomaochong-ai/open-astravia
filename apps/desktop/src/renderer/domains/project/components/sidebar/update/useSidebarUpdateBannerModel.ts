import { updaterStateAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

export interface SidebarUpdateBannerModel {
	label: string;
	actionLabel: string;
	dismissLabel: string;
	onAction: () => void;
	onDismiss: () => void;
	/** 下载中时不提供可点动作，按钮位置改为只读进度。 */
	actionDisabled: boolean;
}

/**
 * 有新版本就出条：available 阶段给「下载」，downloading 阶段显示进度，ready 阶段给「重启更新」。
 * 只在 ready 阶段提示会让「早就查到了新版本、正在下载」的用户以为没有更新。
 */
export function useSidebarUpdateBannerModel(): SidebarUpdateBannerModel | null {
	const { t } = useTranslation("project");
	const state = useAtomValue(updaterStateAtom);
	// 按版本记忆忽略状态：下一个版本出现时重新出现
	const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

	const canPrompt = state.phase === "available" || state.phase === "downloading" || state.phase === "ready";

	const onAction = useCallback(() => {
		if (state.phase === "available") {
			void window.astravia.updater.download();
			return;
		}
		if (state.phase === "ready") void window.astravia.updater.install();
	}, [state.phase]);

	// 忽略：隐藏此条，安装交给退出时的自动流程
	const onDismiss = useCallback(() => {
		setDismissedVersion(state.latestVersion ?? "");
		void window.astravia.updater.dismiss();
	}, [state.latestVersion]);

	if (dismissedVersion !== null && dismissedVersion === (state.latestVersion ?? "")) return null;
	if (!canPrompt) return null;

	const version = state.latestVersion ?? "";
	const percent = Math.round((state.progress ?? 0) * 100);

	return {
		label: state.phase === "ready" ? t("update.bannerReady", { version }) : t("update.bannerAvailable", { version }),
		actionLabel:
			state.phase === "ready"
				? t("update.bannerRestart")
				: state.phase === "downloading"
					? t("update.bannerDownloading", { percent })
					: t("update.bannerDownload"),
		actionDisabled: state.phase === "downloading",
		dismissLabel: t("update.bannerDismiss"),
		onAction,
		onDismiss,
	};
}
