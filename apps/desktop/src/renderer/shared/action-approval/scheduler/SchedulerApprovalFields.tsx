import {
	type AutomationDraft,
	automationDraftToInput,
	automationDraftToPatch,
	canSubmitAutomationDraft,
} from "@domains/scheduler/automation-draft";
import { SchedulerTaskFields } from "@domains/scheduler/components/SchedulerTaskFields";
import type { DesktopActionJsonValue } from "@preload/api";
import { useTranslation } from "react-i18next";

export type SchedulerEditableData = AutomationDraft;
export type SchedulerApprovalJsonData = { [key: string]: DesktopActionJsonValue };

interface SchedulerApprovalFieldsProps {
	value: SchedulerEditableData;
	onChange: (value: SchedulerEditableData) => void;
}

export function SchedulerApprovalFields({ value, onChange }: SchedulerApprovalFieldsProps): JSX.Element {
	const { t } = useTranslation("common");

	return (
		<SchedulerTaskFields
			value={value}
			onChange={onChange}
			namePlaceholder={t("schedulerApproval.taskNamePlaceholder")}
			showEnabled
			promptMinHeight={160}
		/>
	);
}

export function canSubmitSchedulerApproval(value: SchedulerEditableData): boolean {
	return canSubmitAutomationDraft(value);
}

/** 审批通过后回填给 action 的 data：创建给完整输入，更新给显式清除可选项的整份补丁。 */
export function toSchedulerApprovalJsonData(
	value: SchedulerEditableData,
	operation: "create" | "update",
): SchedulerApprovalJsonData {
	const data = operation === "create" ? automationDraftToInput(value) : automationDraftToPatch(value);
	return JSON.parse(JSON.stringify(data)) as SchedulerApprovalJsonData;
}
