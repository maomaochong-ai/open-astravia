import { updaterRestartDialogOpenAtom, updaterStateAtom } from "@shared/store/atoms";
import type { UpdateCheckerViewProps } from "@vetta/theme-ui/overlays";
import { useAtomValue, useSetAtom } from "jotai";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export function useUpdateCheckerModel(): UpdateCheckerViewProps {
	const { t } = useTranslation("settings");
	const state = useAtomValue(updaterStateAtom);
	const openRestartDialog = useSetAtom(updaterRestartDialogOpenAtom);
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
			phase: state.phase,
			progress: state.progress,
			releaseNote: state.releaseNote,
			statusText,
		}),
		[checking, openRestartDialog, state, statusText, t],
	);
}
