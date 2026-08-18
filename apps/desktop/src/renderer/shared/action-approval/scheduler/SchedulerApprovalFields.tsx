import {
	SchedulerTaskFields,
	type SchedulerTaskDraft,
} from "@domains/scheduler/components/SchedulerTaskFields";
import type { DesktopActionJsonValue } from "@preload/api";
import { useTranslation } from "react-i18next";

export type SchedulerEditableData = SchedulerTaskDraft;
export type SchedulerApprovalJsonData = { [key: string]: DesktopActionJsonValue };

interface SchedulerApprovalFieldsProps {
	value: SchedulerEditableData;
	onChange: (value: SchedulerEditableData) => void;
}

export function SchedulerApprovalFields({
	value,
	onChange,
}: SchedulerApprovalFieldsProps): JSX.Element {
	const { t } = useTranslation("common");

	return (
		<SchedulerTaskFields
			value={value}
			onChange={onChange}
			namePlaceholder={t("schedulerApproval.taskNamePlaceholder")}
			showEnabled
			showWorkDirSelector={false}
			promptMinHeight={160}
		/>
	);
}

export function toSchedulerApprovalJsonData(value: SchedulerEditableData): SchedulerApprovalJsonData {
	const data: SchedulerApprovalJsonData = {};
	if (value.name !== undefined) data.name = value.name;
	if (value.prompt !== undefined) data.prompt = value.prompt;
	if (value.cron !== undefined) data.cron = value.cron;
	if (value.isOnce !== undefined) data.isOnce = value.isOnce;
	if (value.enabled !== undefined) data.enabled = value.enabled;
	if (value.cwd !== undefined) data.cwd = value.cwd;
	if (value.modelKey !== undefined) data.modelKey = value.modelKey;
	if (value.executionMode !== undefined) data.executionMode = value.executionMode;
	if (value.skill !== undefined) {
		data.skill = value.skill
			? {
					name: value.skill.name,
					...(value.skill.alias ? { alias: value.skill.alias } : {}),
					type: value.skill.type,
				}
			: null;
	}
	return data;
}
