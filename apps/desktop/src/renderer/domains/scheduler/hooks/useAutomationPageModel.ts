import type { ScheduledTask } from "@shared/store/atoms";
import {
	formOpenAtom,
	pageHeaderTitleHiddenAtom,
	runningTaskIdsAtom,
	scheduledTasksAtom,
	selectedTaskIdAtom,
} from "@shared/store/atoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SchedulerTaskDraft } from "../components/SchedulerTaskFields";
import { RECOMMENDED_AUTOMATION_TASKS, type RecommendedAutomationTaskTemplate } from "../recommended-tasks";
import { useScheduledTasks } from "./useScheduledTasks";

export interface AutomationRecommendationView {
	readonly id: RecommendedAutomationTaskTemplate["id"];
	readonly icon: string;
	readonly title: string;
	readonly description: string;
	readonly scheduleLabel: string;
}

export interface AutomationPageModel {
	readonly dialogOpen: boolean;
	readonly editingTask: ScheduledTask | undefined;
	readonly createDraft: SchedulerTaskDraft | undefined;
	readonly hasTasks: boolean;
	readonly recommendations: readonly AutomationRecommendationView[];
	readonly selectedTask: ScheduledTask | null;
	readonly selectedTaskId: string | null;
	readonly onCloseDialog: () => void;
	readonly onCloseHistory: () => void;
	readonly onEditTask: (task: ScheduledTask) => void;
	readonly onNewTask: () => void;
	readonly onSelectRecommendation: (id: string) => void;
	readonly onSelectTask: (id: string) => void;
}

export function useAutomationPageModel(): AutomationPageModel {
	const { t } = useTranslation("automation");
	const tasks = useAtomValue(scheduledTasksAtom);
	const [selectedTaskId, setSelectedTaskId] = useAtom(selectedTaskIdAtom);
	const [formEditingTask, setFormEditingTask] = useAtom(formOpenAtom);
	const { refreshTasks } = useScheduledTasks();
	const setRunningTaskIds = useSetAtom(runningTaskIdsAtom);
	const setHeaderTitleHidden = useSetAtom(pageHeaderTitleHiddenAtom);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [createDraft, setCreateDraft] = useState<SchedulerTaskDraft | undefined>(undefined);

	useEffect(() => {
		refreshTasks();
	}, [refreshTasks]);

	useEffect(() => {
		setHeaderTitleHidden(true);
		return () => setHeaderTitleHidden(false);
	}, [setHeaderTitleHidden]);

	useEffect(() => {
		void window.vetta.scheduler.getRunningTaskIds().then((ids) => {
			setRunningTaskIds(new Set(ids));
		});
		return window.vetta.scheduler.onTaskEvent((event) => {
			if (event.type === "tasks.changed") return;
			setRunningTaskIds((prev) => {
				const next = new Set(prev);
				if (event.type === "task.started") next.add(event.taskId);
				else next.delete(event.taskId);
				return next;
			});
		});
	}, [setRunningTaskIds]);

	useEffect(() => {
		if (formEditingTask !== undefined) {
			setDialogOpen(true);
		}
	}, [formEditingTask]);

	const recommendations = useMemo((): AutomationRecommendationView[] => {
		return RECOMMENDED_AUTOMATION_TASKS.map((item) => ({
			id: item.id,
			icon: item.icon,
			title: t(`recommend.items.${item.id}.name`),
			description: t(`recommend.items.${item.id}.desc`),
			scheduleLabel: t(`recommend.items.${item.id}.schedule`),
		}));
	}, [t]);

	return useMemo(() => {
		const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

		const handleCloseDialog = (): void => {
			setDialogOpen(false);
			setFormEditingTask(undefined);
			setCreateDraft(undefined);
		};

		const handleNewTask = (): void => {
			setCreateDraft(undefined);
			setFormEditingTask(null);
			setDialogOpen(true);
		};

		const handleEditTask = (task: ScheduledTask): void => {
			setCreateDraft(undefined);
			setFormEditingTask(task);
			setDialogOpen(true);
		};

		const handleSelectRecommendation = (id: string): void => {
			const template = RECOMMENDED_AUTOMATION_TASKS.find((item) => item.id === id);
			if (!template) return;
			setCreateDraft({
				name: t(`recommend.items.${template.id}.name`),
				prompt: t(`recommend.items.${template.id}.prompt`),
				cron: template.cron,
				isOnce: template.isOnce,
				enabled: true,
				executionMode: "full-access",
			});
			setFormEditingTask(null);
			setDialogOpen(true);
		};

		const handleSelectTask = (id: string): void => {
			setSelectedTaskId(selectedTaskId === id ? null : id);
		};

		return {
			dialogOpen,
			editingTask: formEditingTask ?? undefined,
			createDraft,
			hasTasks: tasks.length > 0,
			recommendations,
			selectedTask,
			selectedTaskId,
			onCloseDialog: handleCloseDialog,
			onCloseHistory: () => setSelectedTaskId(null),
			onEditTask: handleEditTask,
			onNewTask: handleNewTask,
			onSelectRecommendation: handleSelectRecommendation,
			onSelectTask: handleSelectTask,
		};
	}, [
		createDraft,
		dialogOpen,
		formEditingTask,
		recommendations,
		selectedTaskId,
		setFormEditingTask,
		setSelectedTaskId,
		t,
		tasks,
	]);
}
