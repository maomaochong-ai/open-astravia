import type { BatchProject } from "@shared/store/batch-tasks-atoms";
import type { BatchTasksPageLabels, BatchTasksPageStatsView } from "@vetta/theme-ui/batch-tasks";
import { BatchTasksPageView as ThemeBatchTasksPageView } from "@vetta/theme-ui/batch-tasks";
import { SettingsAiAssist } from "../../settings/ai-assist";
import { BatchProjectDialog } from "./BatchProjectDialog";
import { BatchTaskList } from "./BatchTaskList";

export interface BatchTasksPageViewProps {
	dialogOpen: boolean;
	dialogProject: BatchProject | null | undefined;
	labels: BatchTasksPageLabels;
	projects: BatchProject[];
	stats: BatchTasksPageStatsView;
	onCloseDialog: () => void;
	onEditProject: (project: BatchProject) => void;
	onNewProject: () => void;
}

export function BatchTasksPageView({
	dialogOpen,
	dialogProject,
	labels,
	projects,
	stats,
	onCloseDialog,
	onEditProject,
	onNewProject,
}: BatchTasksPageViewProps): JSX.Element {
	return (
		<ThemeBatchTasksPageView
			dialog={
				<BatchProjectDialog open={dialogOpen} project={dialogProject ?? undefined} onClose={onCloseDialog} />
			}
			headerTrailing={<SettingsAiAssist tabId="batchTasks" />}
			labels={labels}
			list={<BatchTaskList projects={projects} onEditProject={onEditProject} />}
			onNewProject={onNewProject}
			projectCount={projects.length}
			stats={stats}
		/>
	);
}
