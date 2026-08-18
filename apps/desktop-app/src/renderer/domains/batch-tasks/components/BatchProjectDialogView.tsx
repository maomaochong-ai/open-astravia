import { useTranslation } from "react-i18next";
import { BatchProjectDialogView as ThemeBatchProjectDialogView } from "@vetta/theme-ui/batch-tasks";
import type { BatchProjectDialogModel } from "../hooks/useBatchProjectDialogModel";
import { BatchProjectFormFields } from "./BatchProjectFormFields";

export interface BatchProjectDialogViewProps {
	model: BatchProjectDialogModel;
	open: boolean;
	onClose: () => void;
}

export function BatchProjectDialogView({
	model,
	open,
	onClose,
}: BatchProjectDialogViewProps): JSX.Element {
	const { t } = useTranslation("batch-tasks");

	return (
		<ThemeBatchProjectDialogView
			open={open}
			onClose={onClose}
			onSubmit={model.submit}
			canSubmit={model.canSubmit}
			labels={{
				title: t(model.titleKey),
				cancel: t("dialog.cancel"),
				submit: t(model.submitLabelKey),
			}}
			form={
				<BatchProjectFormFields
					value={model.data}
					onChange={model.setData}
					namePlaceholder={t(model.namePlaceholderKey)}
				/>
			}
		/>
	);
}
