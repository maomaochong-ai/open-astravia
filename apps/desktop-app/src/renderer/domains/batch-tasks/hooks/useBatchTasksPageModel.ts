import type { BatchProject } from "@shared/store/atoms";
import { batchProjectDialogOpenAtom, batchProjectsAtom, pageHeaderTitleHiddenAtom } from "@shared/store/atoms";
import type { BatchTasksPageLabels, BatchTasksPageStatsView } from "@vetta/theme-ui/batch-tasks";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBatchTasks } from "./useBatchTasks";

export interface BatchTasksPageStats {
	total: number;
	running: number;
	completed: number;
	failed: number;
	projects: number;
}

export interface BatchTasksPageModel {
	dialogOpen: boolean;
	dialogProject: BatchProject | null | undefined;
	labels: BatchTasksPageLabels;
	projects: BatchProject[];
	stats: BatchTasksPageStatsView;
	closeDialog: () => void;
	editProject: (project: BatchProject) => void;
	newProject: () => void;
}

function computeStats(projects: BatchProject[]): BatchTasksPageStats {
	let total = 0;
	let running = 0;
	let completed = 0;
	let failed = 0;
	for (const project of projects) {
		for (const task of project.tasks) {
			total += 1;
			if (task.status === "running") running += 1;
			else if (task.status === "completed") completed += 1;
			else if (task.status === "failed") failed += 1;
		}
	}
	return { total, running, completed, failed, projects: projects.length };
}

export function useBatchTasksPageModel(): BatchTasksPageModel {
	const { t } = useTranslation("batch-tasks");
	const projects = useAtomValue(batchProjectsAtom);
	const [dialogProject, setDialogProject] = useAtom(batchProjectDialogOpenAtom);
	const setHeaderTitleHidden = useSetAtom(pageHeaderTitleHiddenAtom);
	const { refreshProjects } = useBatchTasks();
	const [dialogOpen, setDialogOpen] = useState(false);

	useEffect(() => {
		refreshProjects();
	}, [refreshProjects]);

	useEffect(() => {
		setHeaderTitleHidden(true);
		return () => setHeaderTitleHidden(false);
	}, [setHeaderTitleHidden]);

	useEffect(() => {
		if (dialogProject !== undefined) {
			setDialogOpen(true);
		}
	}, [dialogProject]);

	const stats = useMemo(() => computeStats(projects), [projects]);

	const labels = useMemo<BatchTasksPageLabels>(
		() => ({
			title: t("page.title"),
			subtitle: t("page.subtitle"),
			newProject: t("page.newProject"),
			emptyTitle: t("empty.title"),
			emptyDesc: t("empty.desc"),
			emptyAction: t("empty.action"),
			statsTotal: t("stats.total"),
			statsRunning: t("stats.running"),
			statsCompleted: t("stats.completed"),
			statsFailed: t("stats.failed"),
		}),
		[t],
	);

	return {
		dialogOpen,
		dialogProject,
		labels,
		projects,
		stats: {
			total: stats.total,
			running: stats.running,
			completed: stats.completed,
			failed: stats.failed,
		},
		closeDialog: () => {
			setDialogOpen(false);
			setDialogProject(undefined);
		},
		editProject: (project) => {
			setDialogProject(project);
			setDialogOpen(true);
		},
		newProject: () => {
			setDialogProject(null);
			setDialogOpen(true);
		},
	};
}
