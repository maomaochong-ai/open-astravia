import type { ScheduledTask } from "@shared/store/atoms";
import {
	automationCreateRequestAtom,
	pageHeaderTitleHiddenAtom,
	runningTaskIdsAtom,
	scheduledTasksAtom,
	selectedTaskIdAtom,
} from "@shared/store/atoms";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AutomationDraft } from "../automation-draft";
import { AUTOMATION_LIST_FILTERS, type AutomationListFilter } from "../automation-status";
import { RECOMMENDED_AUTOMATION_TASKS, type RecommendedAutomationTaskTemplate } from "../recommended-tasks";
import { useScheduledTasks } from "./useScheduledTasks";

export interface AutomationRecommendationView {
	readonly id: RecommendedAutomationTaskTemplate["id"];
	readonly icon: string;
	readonly title: string;
	readonly description: string;
	readonly scheduleLabel: string;
}

/** 右侧分屏：没打开、编辑某个任务、或新建（可带预填）。 */
export type AutomationPane =
	| { readonly kind: "none" }
	| { readonly kind: "task"; readonly task: ScheduledTask }
	| { readonly kind: "create"; readonly draft: Partial<AutomationDraft> | undefined; readonly key: number };

export interface AutomationPageModel {
	readonly filters: readonly { readonly key: AutomationListFilter; readonly label: string }[];
	readonly activeFilter: AutomationListFilter;
	readonly search: string;
	readonly hasTasks: boolean;
	readonly recommendations: readonly AutomationRecommendationView[];
	readonly pane: AutomationPane;
	readonly selectedTaskId: string | null;
	readonly onFilterChange: (filter: AutomationListFilter) => void;
	readonly onSearchChange: (value: string) => void;
	readonly onCreate: () => void;
	readonly onSelectRecommendation: (id: string) => void;
	readonly onSelectTask: (id: string) => void;
	readonly onClosePane: () => void;
	/** 新建成功后切到该任务的编辑分屏。 */
	readonly onCreated: (task: ScheduledTask) => void;
}

export function useAutomationPageModel(): AutomationPageModel {
	const { t } = useTranslation("automation");
	const tasks = useAtomValue(scheduledTasksAtom);
	const [selectedTaskId, setSelectedTaskId] = useAtom(selectedTaskIdAtom);
	const [createRequest, setCreateRequest] = useAtom(automationCreateRequestAtom);
	const { refreshTasks } = useScheduledTasks();
	const setRunningTaskIds = useSetAtom(runningTaskIdsAtom);
	const setHeaderTitleHidden = useSetAtom(pageHeaderTitleHiddenAtom);
	const [activeFilter, setActiveFilter] = useState<AutomationListFilter>("all");
	const [search, setSearch] = useState("");
	const [creating, setCreating] = useState<{ draft: Partial<AutomationDraft> | undefined; key: number } | null>(null);

	useEffect(() => {
		void refreshTasks();
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

	// 从会话右键菜单等处带着预填内容过来：直接打开新建分屏。
	useEffect(() => {
		if (!createRequest) return;
		setCreateRequest(null);
		setSelectedTaskId(null);
		setCreating({ draft: createRequest, key: Date.now() });
	}, [createRequest, setCreateRequest, setSelectedTaskId]);

	const recommendations = useMemo(
		(): AutomationRecommendationView[] =>
			RECOMMENDED_AUTOMATION_TASKS.map((item) => ({
				id: item.id,
				icon: item.icon,
				title: t(`recommend.items.${item.id}.name`),
				description: t(`recommend.items.${item.id}.desc`),
				scheduleLabel: t(`recommend.items.${item.id}.schedule`),
			})),
		[t],
	);

	return useMemo(() => {
		const selectedTask = tasks.find((task) => task.id === selectedTaskId);
		const pane: AutomationPane = creating
			? { kind: "create", draft: creating.draft, key: creating.key }
			: selectedTask
				? { kind: "task", task: selectedTask }
				: { kind: "none" };
		const openCreate = (draft: Partial<AutomationDraft> | undefined): void => {
			setSelectedTaskId(null);
			setCreating({ draft, key: Date.now() });
		};
		return {
			filters: AUTOMATION_LIST_FILTERS.map((key) => ({ key, label: t(`list.filter.${key}`) })),
			activeFilter,
			search,
			hasTasks: tasks.length > 0,
			recommendations,
			pane,
			selectedTaskId: creating ? null : (selectedTask?.id ?? null),
			onFilterChange: setActiveFilter,
			onSearchChange: setSearch,
			onCreate: () => openCreate(undefined),
			onSelectRecommendation: (id: string) => {
				const template = RECOMMENDED_AUTOMATION_TASKS.find((item) => item.id === id);
				if (!template) return;
				openCreate({
					name: t(`recommend.items.${template.id}.name`),
					prompt: t(`recommend.items.${template.id}.prompt`),
					schedule: template.schedule,
				});
			},
			onSelectTask: (id: string) => {
				setCreating(null);
				setSelectedTaskId(id);
			},
			onClosePane: () => {
				setCreating(null);
				setSelectedTaskId(null);
			},
			onCreated: (task: ScheduledTask) => {
				setCreating(null);
				setSelectedTaskId(task.id);
			},
		};
	}, [activeFilter, creating, recommendations, search, selectedTaskId, setSelectedTaskId, t, tasks]);
}
