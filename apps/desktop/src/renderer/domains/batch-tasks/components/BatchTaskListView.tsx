import type { BatchTaskListActions } from "../hooks/useBatchTaskListModel";
import type { BatchProject } from "@shared/store/batch-tasks-atoms";
import { BatchTaskListView as ThemeBatchTaskListView } from "@vetta/theme-ui/batch-tasks";
import { BatchTaskProjectBlock } from "./batch-task-list/BatchTaskProjectBlock";

interface BatchTaskListViewProps {
	actions: BatchTaskListActions;
	projects: BatchProject[];
	queuedTaskIds: Set<string>;
	onEditProject: (project: BatchProject) => void;
}

export function BatchTaskListView({
	actions,
	projects,
	queuedTaskIds,
	onEditProject,
}: BatchTaskListViewProps): JSX.Element {
	return (
		<ThemeBatchTaskListView>
			{projects.map((project) => (
				<BatchTaskProjectBlock
					key={project.id}
					actions={actions}
					project={project}
					queuedTaskIds={queuedTaskIds}
					onEditProject={onEditProject}
				/>
			))}
		</ThemeBatchTaskListView>
	);
}
