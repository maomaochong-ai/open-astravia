import type { BatchProject } from "@shared/store/atoms";
import { BatchTaskProjectBlockView } from "@vetta/theme-ui/batch-tasks";
import type { BatchTaskListActions } from "../../hooks/useBatchTaskListModel";
import { useBatchTaskProjectBlockModel } from "../../hooks/useBatchTaskProjectBlockModel";

export function BatchTaskProjectBlock({
	actions,
	project,
	queuedTaskIds,
	onEditProject,
}: {
	actions: BatchTaskListActions;
	project: BatchProject;
	queuedTaskIds: Set<string>;
	onEditProject: (project: BatchProject) => void;
}): JSX.Element {
	const model = useBatchTaskProjectBlockModel(project, actions, queuedTaskIds, onEditProject);

	return (
		<BatchTaskProjectBlockView
			actionsLabels={model.actionsLabels}
			cardLabels={model.cardLabels}
			callbacks={model.callbacks}
			counts={model.counts}
			gridLabels={model.gridLabels}
			hasQueued={model.hasQueued}
			headerLabels={model.headerLabels}
			projectName={model.projectName}
			tasks={model.tasks}
		/>
	);
}
