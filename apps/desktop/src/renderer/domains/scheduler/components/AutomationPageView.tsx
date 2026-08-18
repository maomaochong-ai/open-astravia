import type { ScheduledTask } from "@shared/store/scheduler-atoms";
import {
	AutomationPageView as ThemeAutomationPageView,
	type AutomationRecommendationItem,
} from "@vetta/theme-ui/scheduler";
import { useTranslation } from "react-i18next";
import { SettingsAiAssist } from "../../settings/ai-assist";
import type { SchedulerTaskDraft } from "./SchedulerTaskFields";
import { HistoryDrawer } from "./HistoryDrawer";
import { TaskFormDialog } from "./TaskForm";
import { TaskList } from "./TaskList";

export interface AutomationPageViewProps {
	readonly dialogOpen: boolean;
	readonly editingTask: ScheduledTask | undefined;
	readonly createDraft: SchedulerTaskDraft | undefined;
	readonly hasTasks: boolean;
	readonly recommendations: readonly AutomationRecommendationItem[];
	readonly selectedTask: ScheduledTask | null;
	readonly selectedTaskId: string | null;
	readonly onCloseDialog: () => void;
	readonly onCloseHistory: () => void;
	readonly onEditTask: (task: ScheduledTask) => void;
	readonly onNewTask: () => void;
	readonly onSelectRecommendation: (id: string) => void;
	readonly onSelectTask: (id: string) => void;
}

export function AutomationPageView({
	dialogOpen,
	editingTask,
	createDraft,
	hasTasks,
	recommendations,
	selectedTask,
	selectedTaskId,
	onCloseDialog,
	onCloseHistory,
	onEditTask,
	onNewTask,
	onSelectRecommendation,
	onSelectTask,
}: AutomationPageViewProps): JSX.Element {
	const { t } = useTranslation("automation");

	return (
		<ThemeAutomationPageView
			hasTasks={hasTasks}
			headerTrailing={<SettingsAiAssist tabId="automation" />}
			onNewTask={onNewTask}
			recommendations={hasTasks ? undefined : recommendations}
			onSelectRecommendation={onSelectRecommendation}
			labels={{
				title: t("page.title"),
				subtitle: t("page.subtitle"),
				newTask: t("page.newTask"),
				newTaskTitle: t("page.newTaskTitle"),
				recommendTitle: t("recommend.title"),
				recommendUse: t("recommend.use"),
			}}
			taskList={
				<TaskList
					selectedTaskId={selectedTaskId}
					onSelectTask={onSelectTask}
					onEditTask={onEditTask}
				/>
			}
			historyDrawer={
				<HistoryDrawer task={selectedTask} onClose={onCloseHistory} onEdit={onEditTask} />
			}
			taskFormDialog={
				<TaskFormDialog
					open={dialogOpen}
					task={editingTask}
					initialDraft={createDraft}
					onClose={onCloseDialog}
				/>
			}
		/>
	);
}
