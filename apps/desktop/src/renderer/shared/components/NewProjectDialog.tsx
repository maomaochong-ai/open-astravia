import { NewProjectDialogView } from "@vetta/theme-ui/project";
import { useTranslation } from "react-i18next";

interface NewProjectDialogProps {
	onConfirm: (name: string) => void;
	onCancel: () => void;
	/** 已被占用的项目名，用于在确认时拦下重名。 */
	isNameTaken?: (name: string) => boolean;
}

/** Desktop adapter — feeds localized copy into the presentational view. */
export function NewProjectDialog({ onConfirm, onCancel, isNameTaken }: NewProjectDialogProps): JSX.Element {
	const { t } = useTranslation("project");

	return (
		<NewProjectDialogView
			onConfirm={onConfirm}
			onCancel={onCancel}
			isNameTaken={isNameTaken}
			labels={{
				title: t("newProjectDialog.title"),
				description: t("newProjectDialog.description"),
				placeholder: t("newProjectDialog.placeholder"),
				cancel: t("newProjectDialog.cancel"),
				create: t("newProjectDialog.create"),
				emptyError: t("newProjectDialog.emptyError"),
				invalidError: t("newProjectDialog.invalidError"),
				duplicateError: t("newProjectDialog.duplicateError"),
			}}
		/>
	);
}
