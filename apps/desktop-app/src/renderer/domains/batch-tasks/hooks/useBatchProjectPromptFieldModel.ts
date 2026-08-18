import { useTranslation } from "react-i18next";

export interface BatchProjectPromptFieldModel {
	placeholder: string;
}

export function useBatchProjectPromptFieldModel(): BatchProjectPromptFieldModel {
	const { t } = useTranslation("batch-tasks");
	return { placeholder: t("form.promptPlaceholder") };
}
