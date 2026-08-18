import { useTranslation } from "react-i18next";
import { BatchProjectFoldersFieldView } from "@vetta/theme-ui/batch-tasks";

export function BatchProjectFoldersField({
	emptyText,
	folderInputMode,
	folderText,
	folders,
	label,
	onFolderTextChange,
	onInputModeChange,
	onRemoveFolder,
	onSelectFolders,
}: {
	emptyText: string;
	folderInputMode: "picker" | "textarea";
	folderText: string;
	folders: string[];
	label: string;
	onFolderTextChange: (value: string) => void;
	onInputModeChange: (mode: "picker" | "textarea") => void;
	onRemoveFolder: (folder: string) => void;
	onSelectFolders: () => void;
}): JSX.Element {
	const { t } = useTranslation("batch-tasks");

	return (
		<BatchProjectFoldersFieldView
			emptyText={emptyText}
			folderInputMode={folderInputMode}
			folderText={folderText}
			folders={folders}
			label={label}
			onFolderTextChange={onFolderTextChange}
			onInputModeChange={onInputModeChange}
			onRemoveFolder={onRemoveFolder}
			onSelectFolders={onSelectFolders}
			labels={{
				folderModePicker: t("form.folderModePicker"),
				folderModeText: t("form.folderModeText"),
				selectFolder: t("form.selectFolder"),
				folderTextHint: t("form.folderTextHint"),
			}}
		/>
	);
}
