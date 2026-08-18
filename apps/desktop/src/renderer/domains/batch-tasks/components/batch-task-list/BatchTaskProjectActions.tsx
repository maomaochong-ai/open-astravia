import type { BatchProject } from "@shared/store/atoms";
import { BatchTaskProjectActionsView } from "@vetta/theme-ui/batch-tasks";
import type { BatchTaskListActions, ProjectCounts } from "../../hooks/useBatchTaskListModel";
import { useBatchTaskProjectActionsModel } from "../../hooks/useBatchTaskProjectActionsModel";

export function BatchTaskProjectActions({
	actions,
	counts,
	project,
	queuedTaskIds,
	onEditProject,
}: {
	actions: BatchTaskListActions;
	counts: ProjectCounts;
	project: BatchProject;
	queuedTaskIds: Set<string>;
	onEditProject: (project: BatchProject) => void;
}): JSX.Element {
	const model = useBatchTaskProjectActionsModel(project, queuedTaskIds);

	return (
		<BatchTaskProjectActionsView
			counts={counts}
			hasQueued={model.hasQueued}
			labels={model.labels}
			onBatchReset={() => actions.batchReset(project)}
			onBatchStart={() => actions.batchStart(project, counts)}
			onBatchStop={() => actions.batchStop(project, counts)}
			onDeleteProject={() => actions.deleteProject(project)}
			onEditProject={() => onEditProject(project)}
		/>
	);
}
