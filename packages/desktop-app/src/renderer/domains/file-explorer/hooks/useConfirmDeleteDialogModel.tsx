import { Button } from "@shared/components/ui/button";
import type { FsEntry } from "@shared/store/atoms";
import type { ConfirmDeleteDialogViewProps } from "@vetta/theme-ui/file-explorer";
import { useTranslation } from "react-i18next";

export function useConfirmDeleteDialogModel(
	entries: readonly FsEntry[],
	onConfirm: () => void,
	onCancel: () => void,
): ConfirmDeleteDialogViewProps {
	const { t } = useTranslation("chat");
	const single = entries.length === 1 ? entries[0] : null;

	const description = single ? (
		<>
			{t("fileExplorer.confirmDeletePrefix", {
				type: single.isDirectory
					? t("fileExplorer.confirmDeleteFolder")
					: t("fileExplorer.confirmDeleteFile"),
			})}{" "}
			<span className="font-medium text-foreground">{single.name}</span>{" "}
			{t("fileExplorer.confirmDeleteSuffix", {
				folderNote: single.isDirectory ? t("fileExplorer.confirmDeleteFolderNote") : "",
			})}
		</>
	) : (
		<>
			{t("fileExplorer.confirmDeleteMultiplePrefix", { count: entries.length })}{" "}
			<span className="font-medium text-foreground">
				{entries
					.slice(0, 3)
					.map((entry) => entry.name)
					.join(", ")}
				{entries.length > 3 ? t("fileExplorer.confirmDeleteMultipleMore", { count: entries.length - 3 }) : ""}
			</span>{" "}
			{t("fileExplorer.confirmDeleteMultipleSuffix")}
		</>
	);

	return {
		labels: {
			title: t("fileExplorer.confirmDeleteTitle"),
			description,
		},
		onCancel,
		cancelButton: (
			<Button variant="ghost" size="sm" onClick={onCancel}>
				{t("fileExplorer.cancel")}
			</Button>
		),
		confirmButton: (
			<Button variant="destructive" size="sm" onClick={onConfirm}>
				{t("fileExplorer.delete")}
			</Button>
		),
	};
}
