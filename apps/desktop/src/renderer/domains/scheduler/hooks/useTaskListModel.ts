import { runningTaskIdsAtom, scheduledTasksAtom } from "@shared/store/atoms";
import type { TFunction } from "i18next";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ScheduledTask } from "../../../../shared/automation";
import { nextFireTime } from "../../../../shared/automation-timing";
import {
	type AutomationListFilter,
	type AutomationTaskTone,
	automationTaskTone,
	matchesAutomationFilter,
} from "../automation-status";
import { describeSchedule } from "../components/schedule-picker/describe-schedule";

export interface TaskListItemModel {
	readonly id: string;
	readonly name: string;
	readonly subtitle: string;
	readonly tone: AutomationTaskTone;
	readonly isSelected: boolean;
}

export interface TaskListModel {
	readonly items: readonly TaskListItemModel[];
	readonly emptyLabel: string | undefined;
}

interface UseTaskListModelOptions {
	readonly selectedTaskId: string | null;
	readonly filter: AutomationListFilter;
	readonly search: string;
}

/** 「下次运行」按分钟刷新即可，不需要秒级重渲染。 */
const CLOCK_TICK_MS = 60_000;

export function useTaskListModel({ selectedTaskId, filter, search }: UseTaskListModelOptions): TaskListModel {
	const { t } = useTranslation("automation");
	const tasks = useAtomValue(scheduledTasksAtom);
	const runningTaskIds = useAtomValue(runningTaskIdsAtom);
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
		return () => clearInterval(timer);
	}, []);

	return useMemo(() => {
		const query = search.trim().toLowerCase();
		const items = tasks
			.map((task) => ({ task, tone: automationTaskTone(task, runningTaskIds.has(task.id)) }))
			.filter(({ task, tone }) => {
				if (!matchesAutomationFilter(tone, filter)) return false;
				if (!query) return true;
				return task.name.toLowerCase().includes(query) || task.prompt.toLowerCase().includes(query);
			})
			.sort((a, b) => b.task.createdAt - a.task.createdAt)
			.map(({ task, tone }) => ({
				id: task.id,
				name: task.name,
				subtitle: subtitleFor(task, tone, now, t),
				tone,
				isSelected: task.id === selectedTaskId,
			}));
		return {
			items,
			// 一个任务都没有时由页面展示推荐模板；有任务但被筛掉时才提示。
			emptyLabel: tasks.length === 0 ? undefined : query ? t("list.emptySearch") : t("list.emptyFilter"),
		};
	}, [filter, now, runningTaskIds, search, selectedTaskId, t, tasks]);
}

function subtitleFor(task: ScheduledTask, tone: AutomationTaskTone, now: number, t: TFunction<"automation">): string {
	const schedule = describeSchedule(task.schedule, t);
	switch (tone) {
		case "running":
			return `${schedule} · ${t("list.running")}`;
		case "suspended":
			return `${schedule} · ${t("list.suspended")}`;
		case "paused":
			return `${schedule} · ${t("list.disabled")}`;
		case "done":
			return `${schedule} · ${t("list.done")}`;
		case "active": {
			const next = nextFireTime(task.schedule, now);
			return next === null
				? schedule
				: `${schedule} · ${t("list.nextRun", { when: formatRelative(next - now, t) })}`;
		}
	}
}

export function formatRelative(ms: number, t: TFunction<"automation">): string {
	const minutes = Math.max(1, Math.round(ms / 60_000));
	if (minutes < 60) return t("list.inMinutes", { n: minutes });
	const hours = Math.round(minutes / 60);
	if (hours < 48) return t("list.inHours", { n: hours });
	return t("list.inDays", { n: Math.round(hours / 24) });
}
