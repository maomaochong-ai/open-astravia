import {
	type ExecutionModeOverride,
	type SelectedSkill,
} from "@shared/store/atoms";
import { useTranslation } from "react-i18next";
import { useBatchProjectFormFieldsModel } from "../hooks/useBatchProjectFormFieldsModel";
import { BatchProjectFormFieldsView } from "./BatchProjectFormFieldsView";

export {
	compactLines,
	normalizeConcurrency,
	normalizeTimeout,
	toBatchProjectApprovalJsonData,
} from "../utils/batchProjectFormData";

export interface BatchProjectEditableData {
	name?: string;
	prompt?: string;
	modelKey?: string;
	executionMode?: ExecutionModeOverride;
	concurrency?: number;
	artifactPatterns?: string[];
	notifyEnabled?: boolean;
	timeoutMinutes?: number;
	folders?: string[];
	newFolders?: string[];
	skill?: SelectedSkill | null;
}

interface BatchProjectFormFieldsProps {
	value: BatchProjectEditableData;
	onChange: (value: BatchProjectEditableData) => void;
	namePlaceholder?: string;
	promptMinHeight?: number;
	folderField?: "folders" | "newFolders";
	folderLabel?: string;
	folderEmptyText?: string;
	showFolders?: boolean;
}

export interface BatchProjectApprovalJsonData {
	name?: string;
	prompt?: string;
	modelKey?: string;
	executionMode?: ExecutionModeOverride;
	concurrency?: number;
	artifactPatterns?: string[];
	notifyEnabled?: boolean;
	timeoutMinutes?: number;
	folders?: string[];
	newFolders?: string[];
	skill?: SelectedSkill | null;
}

export function BatchProjectFormFields({
	value,
	onChange,
	namePlaceholder,
	promptMinHeight = 120,
	folderField = "folders",
	folderLabel,
	folderEmptyText,
	showFolders = true,
}: BatchProjectFormFieldsProps): JSX.Element {
	const { t } = useTranslation("batch-tasks");
	const namePlaceholderText = namePlaceholder ?? t("form.namePlaceholder");
	const folderLabelText = folderLabel ?? t("form.folderLabel");
	const folderEmptyTextValue = folderEmptyText ?? t("form.folderEmpty");
	const model = useBatchProjectFormFieldsModel({ folderField, onChange, value });

	return (
		<BatchProjectFormFieldsView
			folderEmptyText={folderEmptyTextValue}
			folderLabel={folderLabelText}
			model={model}
			namePlaceholder={namePlaceholderText}
			promptMinHeight={promptMinHeight}
			showFolders={showFolders}
		/>
	);
}
