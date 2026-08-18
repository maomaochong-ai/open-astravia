import { useTranslation } from "react-i18next";
import { KnowledgeSourcePickerView } from "@vetta/theme-ui/knowledge";

interface KnowledgeSourcePickerProps {
	onPickFiles: () => void;
	onPickFolders: () => void;
	size?: "sm";
}

export function KnowledgeSourcePicker({
	onPickFiles,
	onPickFolders,
	size,
}: KnowledgeSourcePickerProps): JSX.Element {
	const { t } = useTranslation("settings");

	return (
		<KnowledgeSourcePickerView
			onPickFiles={onPickFiles}
			onPickFolders={onPickFolders}
			size={size}
			labels={{
				addMaterials: t("kbAddMaterials"),
				pickFiles: t("kbPickFiles"),
				pickFolders: t("kbPickFolders"),
			}}
		/>
	);
}
