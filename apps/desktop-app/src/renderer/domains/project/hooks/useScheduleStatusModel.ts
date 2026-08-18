import { describeSchedule, parseCronExpression } from "@domains/scheduler/components/schedule-picker/cron-utils";
import { useScheduledTasks } from "@domains/scheduler/hooks/useScheduledTasks";
import type { ScheduledTask } from "@shared/store/atoms";
import type { ScheduleStatusViewProps, ScheduleTaskItemView } from "@vetta/theme-ui/project";
import type { TFunction } from "i18next";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

function formatLastRun(timestamp: number | null, t: TFunction<"automation">): string {
	if (!timestamp) return t("list.neverRun");
	const diff = Date.now() - timestamp;
	if (diff < 60_000) return t("list.justNow");
	if (diff < 3_600_000) return t("list.minutesAgo", { n: Math.floor(diff / 60_000) });
	if (diff < 86_400_000) return t("list.hoursAgo", { n: Math.floor(diff / 3_600_000) });
	return t("list.daysAgo", { n: Math.floor(diff / 86_400_000) });
}

function scheduleLabel(task: ScheduledTask, t: TFunction<"automation">): string {
	const parsed = parseCronExpression(task.cron, task.isOnce);
	if (parsed) return describeSchedule(parsed, t);
	return task.cron;
}

export function useScheduleStatusModel(cwd: string): ScheduleStatusViewProps | null {
	const { t } = useTranslation("automation");
	const { tasks, runNow, toggleTask, refreshTasks } = useScheduledTasks();

	useEffect(() => {
		void refreshTasks();
	}, [refreshTasks]);

	useEffect(() => {
		const unsubscribe = window.vetta.scheduler.onTaskEvent(() => {
			void refreshTasks();
		});
		return unsubscribe;
	}, [refreshTasks]);

	const projectTasks = useMemo(() => tasks.filter((task) => task.cwd === cwd), [cwd, tasks]);

	const viewTasks: ScheduleTaskItemView[] = useMemo(
		() =>
			projectTasks.map((task) => ({
				id: task.id,
				name: task.name,
				enabled: task.enabled,
				scheduleLabel: scheduleLabel(task, t),
				lastRunLabel: formatLastRun(task.lastRunAt, t),
				lastRunStatus: task.lastRunStatus ?? null,
			})),
		[projectTasks, t],
	);

	if (viewTasks.length === 0) return null;

	return {
		labels: {
			sectionTitle: t("list.sectionTitle"),
			pause: t("list.pause"),
			enable: t("list.enable"),
			runNow: t("list.runNow"),
			run: t("list.run"),
			success: t("list.success"),
			failed: t("list.failed"),
		},
		tasks: viewTasks,
		onRun: (taskId) => {
			void runNow(taskId);
		},
		onToggle: (taskId) => {
			void toggleTask(taskId);
		},
	};
}
