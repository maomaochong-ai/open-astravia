import type { BatchProject } from "@shared/store/atoms";
import { useBatchTaskListModel } from "../hooks/useBatchTaskListModel";
import { BatchTaskListView } from "./BatchTaskListView";

interface BatchTaskListProps {
	projects: BatchProject[];
	onEditProject: (project: BatchProject) => void;
}

export function BatchTaskList({ projects, onEditProject }: BatchTaskListProps): JSX.Element {
	const model = useBatchTaskListModel(projects);

	return (
		<BatchTaskListView
			actions={model.actions}
			projects={model.projects}
			queuedTaskIds={model.queuedTaskIds}
			onEditProject={onEditProject}
		/>
	);
}
