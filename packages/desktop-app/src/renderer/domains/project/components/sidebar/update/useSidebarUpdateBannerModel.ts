import { updaterStateAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

export interface SidebarUpdateBannerModel {
	label: string;
	restartLabel: string;
	dismissLabel: string;
	onRestart: () => void;
	onDismiss: () => void;
}

/** 下载完成（phase === "ready"）后才返回 model；其余阶段返回 null。 */
export function useSidebarUpdateBannerModel(): SidebarUpdateBannerModel | null {
	const { t } = useTranslation("project");
	const state = useAtomValue(updaterStateAtom);
	// 按版本记忆忽略状态：下一个版本就绪时重新出现
	const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

	const onRestart = useCallback(() => {
		void window.vetta.updater.install();
	}, []);

	// 忽略：隐藏此条，安装交给退出时的自动流程
	const onDismiss = useCallback(() => {
		setDismissedVersion(state.latestVersion ?? "");
		void window.vetta.updater.dismiss();
	}, [state.latestVersion]);

	if (dismissedVersion !== null && dismissedVersion === (state.latestVersion ?? "")) return null;
	if (state.phase !== "ready") return null;

	return {
		label: t("update.bannerReady", { version: state.latestVersion ?? "" }),
		restartLabel: t("update.bannerRestart"),
		dismissLabel: t("update.bannerDismiss"),
		onRestart,
		onDismiss,
	};
}
