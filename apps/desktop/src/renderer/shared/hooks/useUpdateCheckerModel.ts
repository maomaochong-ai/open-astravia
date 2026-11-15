import { normalizeReleaseNote, type UpdateCheckerViewProps } from "@astravia-org/theme-ui/overlays";
import { useAtomValue, useSetAtom } from "jotai";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { filePreviewAtom } from "../store/file-preview-atoms";
import {
	updaterCurrentNotesDialogOpenAtom,
	updaterRestartDialogOpenAtom,
	updaterStateAtom,
} from "../store/updater-atoms";

export function useUpdateCheckerModel(): UpdateCheckerViewProps {
	const { t } = useTranslation("settings");
	const state = useAtomValue(updaterStateAtom);
	const openRestartDialog = useSetAtom(updaterRestartDialogOpenAtom);
	const openCurrentNotes = useSetAtom(updaterCurrentNotesDialogOpenAtom);
	const setFilePreview = useSetAtom(filePreviewAtom);
	const [busy, setBusy] = useState(false);

	const checking = busy || state.phase === "checking";

	const statusText = (() => {
		if (state.phase === "checking") return t("updaterChecking");
		if (state.phase === "error") return state.error ?? "";
		if (state.phase === "idle") {
			// 显示当前版本号和最新版本号（如果有）
			const current = state.currentVersion || t("updaterUnknownVersion");
			if (state.latestVersion && state.latestVersion !== state.currentVersion) {
				return t("updaterIdleWithUpdate", { current, latest: state.latestVersion });
			}
			return t("updaterIdle", { version: current });
		}
		return "";
	})();

	return useMemo(
		() => ({
			checking,
			currentVersion: state.currentVersion,
			labels: {
				check: t("updaterCheck"),
				checking: t("updaterChecking"),
				checkingBtn: t("updaterCheckingBtn"),
				currentVersion: (version) => t("updaterCurrentVersion", { version }),
				download: t("updaterDownload"),
				downloading: (progress) => t("updaterDownloading", { progress }),
				idle: (version) => t("updaterIdle", { version }),
				newVersion: (version) => t("updaterNewVersion", { version }),
				restart: t("updaterRestart"),
				viewCurrent: t("updaterViewCurrent"),
				viewMore: t("updaterViewMore"),
			},
			latestVersion: state.latestVersion,
			onCheck: () => {
				// 结果（检查中 / 已是最新 / 新版本 / 出错）都在更新对话框里展示。
				openRestartDialog(true);
				setBusy(true);
				void window.astravia.updater.check().finally(() => setBusy(false));
			},
			onViewCurrent: () => openCurrentNotes(true),
			onPrimary: () => {
				if (state.phase === "available") {
					void window.astravia.updater.download();
					return;
				}
				if (state.phase === "ready") {
					openRestartDialog(true);
				}
			},
			onViewMore: () => {
				if (!state.releaseNote) return;
				// 同一个 releaseNote 可能是 GitHub feed 的 HTML：「查看更多」里也归一化，
				// 否则预览页会把标签原样显示。
				const blob = new Blob([normalizeReleaseNote(state.releaseNote)], { type: "text/markdown" });
				const url = URL.createObjectURL(blob);
				const versionName = state.latestVersion ? `v${state.latestVersion}` : "update";
				setFilePreview({
					name: `${versionName}_changelog.md`,
					url,
				});
			},
			phase: state.phase,
			progress: state.progress,
			releaseNote: state.releaseNote,
			statusText,
		}),
		[checking, openCurrentNotes, openRestartDialog, setFilePreview, state, statusText, t],
	);
}
