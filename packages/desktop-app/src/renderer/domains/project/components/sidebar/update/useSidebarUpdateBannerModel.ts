import { updaterStateAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

export interface SidebarUpdateBannerModel {
	stage: "available" | "ready";
	label: string;
	actionLabel: string;
	dismissLabel: string;
	onAction: () => void;
	onDismiss: () => void;
	progress?: number;
}

/**
 * available 阶段：自动检查到新版本时弹「新版本 X 可用」，点 action 开始下载。
 * ready 阶段：下载完成后弹「新版本 X 已就绪」，点 action 立即重启安装。
 * 其余阶段返回 null。
 */
export function useSidebarUpdateBannerModel(): SidebarUpdateBannerModel | null {
	const { t } = useTranslation("project");
	const state = useAtomValue(updaterStateAtom);
	// 按版本记忆忽略状态：下一个版本就绪时重新出现
	const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

	const onAction = useCallback(() => {
		if (state.phase === "available") {
			void window.astravia.updater.startDownload();
		} else if (state.phase === "ready") {
			void window.astravia.updater.install();
		}
	}, [state.phase]);

	const onDismiss = useCallback(() => {
		setDismissedVersion(state.latestVersion ?? "");
		if (state.phase === "ready") {
			void window.astravia.updater.dismiss();
		}
	}, [state.latestVersion, state.phase]);

	if (dismissedVersion !== null && dismissedVersion === (state.latestVersion ?? "")) return null;

	if (state.phase === "available") {
		return {
			stage: "available",
			label: t("update.bannerAvailable", { version: state.latestVersion ?? "" }),
			actionLabel: t("update.bannerDownload"),
			dismissLabel: t("update.bannerDismiss"),
			onAction,
			onDismiss,
		};
	}

	if (state.phase === "ready") {
		return {
			stage: "ready",
			label: t("update.bannerReady", { version: state.latestVersion ?? "" }),
			actionLabel: t("update.bannerRestart"),
			dismissLabel: t("update.bannerDismiss"),
			onAction,
			onDismiss,
		};
	}

	return null;
}
