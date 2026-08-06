import { useShortcutScope } from "@shared/shortcuts";
import { updaterRestartDialogOpenAtom, updaterStateAtom } from "@shared/store/atoms";
import { useAtom, useAtomValue } from "jotai";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { UpdateRestartDialogViewProps } from "./UpdateRestartDialogView";

export type UpdateRestartDialogModel = UpdateRestartDialogViewProps;

export function useUpdateRestartDialogModel(): UpdateRestartDialogModel {
	const { t } = useTranslation("common");
	const [open, setOpen] = useAtom(updaterRestartDialogOpenAtom);
	const state = useAtomValue(updaterStateAtom);
	const overlayRef = useRef<HTMLDivElement>(null);

	const close = () => setOpen(false);

	const visible = open && state.phase === "ready";

	useShortcutScope({
		id: "modal:update-restart",
		kind: "modal",
		active: visible,
		exclusive: true,
		bindings: [{ key: "escape", run: () => setOpen(false) }],
	});

	const handleInstall = () => {
		setOpen(false);
		void window.vetta.updater.install();
	};

	return {
		labels: {
			install: t("updateRestart.install"),
			later: t("updateRestart.later"),
			message: t("updateRestart.message", {
				currentVersion: state.currentVersion,
				latestVersion: state.latestVersion,
			}),
			title: t("updateRestart.title"),
		},
		onClose: close,
		onInstall: handleInstall,
		overlayRef,
		releaseNote: state.releaseNote,
		visible,
	};
}
