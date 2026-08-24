import type { UpdateCheckerViewProps } from "@vetta/theme-ui/overlays";
import { useAtomValue, useSetAtom } from "jotai";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { filePreviewAtom } from "../store/file-preview-atoms";
import { updaterRestartDialogOpenAtom, updaterStateAtom } from "../store/updater-atoms";

export function useUpdateCheckerModel(): UpdateCheckerViewProps {
	const { t } = useTranslation("settings");
	const state = useAtomValue(updaterStateAtom);
	const openRestartDialog = useSetAtom(updaterRestartDialogOpenAtom);
	const setFilePreview = useSetAtom(filePreviewAtom);
	const [busy, setBusy] = useState(false);

	const checking = busy || state.phase === "checking";

	const statusText = (() => {
		if (state.phase === "checking") return t("updaterChecking");
		if (state.phase === "error") return state.error ?? "";
		if (state.phase === "idle") return t("updaterIdle", { version: state.currentVersion });
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
				viewMore: t("updaterViewMore"),
			},
			latestVersion: state.latestVersion,
			onCheck: () => {
				setBusy(true);
				void window.vetta.updater.check().finally(() => setBusy(false));
			},
			onPrimary: () => {
				if (state.phase === "available") {
					void window.vetta.updater.download();
					return;
				}
				if (state.phase === "ready") {
					openRestartDialog(true);
				}
			},
			onViewMore: () => {
				if (!state.releaseNote) return;
				const blob = new Blob([state.releaseNote], { type: "text/markdown" });
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
		[checking, openRestartDialog, setFilePreview, state, statusText, t],
	);
}
