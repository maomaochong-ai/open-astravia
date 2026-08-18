import {
	HistoryDrawerView as ThemeHistoryDrawerView,
	type HistoryDrawerTaskView,
	type HistoryDrawerViewLabels,
} from "@vetta/theme-ui/scheduler";
import { useTranslation } from "react-i18next";
import { ExecutionHistory } from "./ExecutionHistory";

export type { HistoryDrawerTaskView };

export interface HistoryDrawerViewProps {
	readonly projectLabel: string | null;
	readonly scheduleLabel: string;
	readonly task: HistoryDrawerTaskView | null;
	readonly onClose: () => void;
	readonly onEdit: () => void;
	readonly onRunNow: () => void;
	readonly onToggleTask: () => void;
}

export function HistoryDrawerView({
	projectLabel,
	scheduleLabel,
	task,
	onClose,
	onEdit,
	onRunNow,
	onToggleTask,
}: HistoryDrawerViewProps): JSX.Element {
	const { t } = useTranslation("automation");
	const labels: HistoryDrawerViewLabels = {
		close: t("drawer.close"),
		edit: t("drawer.edit"),
		enable: t("drawer.enable"),
		pause: t("drawer.pause"),
		runNow: t("drawer.runNow"),
	};

	return (
		<ThemeHistoryDrawerView
			history={task ? <ExecutionHistory taskId={task.id} embedded /> : null}
			labels={labels}
			projectLabel={projectLabel}
			scheduleLabel={scheduleLabel}
			task={task}
			onClose={onClose}
			onEdit={onEdit}
			onRunNow={onRunNow}
			onToggleTask={onToggleTask}
		/>
	);
}
