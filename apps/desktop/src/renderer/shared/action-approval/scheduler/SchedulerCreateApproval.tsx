import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useThemeComponent } from "@vetta/theme-sdk";
import {
	type SchedulerEditableData,
	toSchedulerApprovalJsonData,
} from "./SchedulerApprovalFields";
import { SchedulerEditApprovalDrawerView } from "./SchedulerEditApprovalDrawerView";
import { useActionApproval, type ActiveActionApproval } from "../useActionApproval";

interface CreateTaskData extends SchedulerEditableData {
	name: string;
	prompt: string;
	cron: string;
	isOnce: boolean;
	cwd: string;
	skill?: { name: string; alias?: string; type: "skill" | "scene" };
}

interface CreateTaskInput {
	operation: "create";
	data: CreateTaskData;
	approvalUi?: string;
}

export function SchedulerCreateApproval(): JSX.Element | null {
	const approval = useActionApproval("scheduler.create");
	if (!approval) return null;
	return <SchedulerCreateDrawer key={approval.request.approvalId} approval={approval} />;
}

function SchedulerCreateDrawer({ approval }: { approval: ActiveActionApproval }): JSX.Element {
	const { t } = useTranslation("common");
	const { request, responding, error, approve, reject } = approval;
	const input = request.input as unknown as CreateTaskInput;
	const [data, setData] = useState<SchedulerEditableData>(input.data);
	const ThemedSchedulerEditApprovalDrawerView = useThemeComponent(
		"root.approval.schedulerEditView",
		SchedulerEditApprovalDrawerView,
	);

	return (
		<ThemedSchedulerEditApprovalDrawerView
			title={t("schedulerApproval.createTitle")}
			description={t("schedulerApproval.createDescription")}
			value={data}
			error={error}
			responding={responding}
			countdown={approval.countdown.formatted}
			labels={{
				reject: t("actionApproval.reject"),
				submit: t("schedulerApproval.confirmCreate"),
				submitting: t("schedulerApproval.creating"),
				taskId: t("schedulerApproval.taskId"),
				permission: t("actionApproval.permission", { permission: request.permission }),
			}}
			onChange={setData}
			onReject={reject}
			onSubmit={() =>
				approve({
					operation: "create",
					data: toSchedulerApprovalJsonData({ ...input.data, ...data }),
					approvalUi: input.approvalUi ?? "scheduler.create",
				})
			}
		/>
	);
}
