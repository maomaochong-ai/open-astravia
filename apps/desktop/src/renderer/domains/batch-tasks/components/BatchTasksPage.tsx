import { useBatchTasksPageModel } from "../hooks/useBatchTasksPageModel";
import { BatchTasksPageView } from "./BatchTasksPageView";

export function BatchTasksPage(): JSX.Element {
	const model = useBatchTasksPageModel();

	return (
		<BatchTasksPageView
			dialogOpen={model.dialogOpen}
			dialogProject={model.dialogProject}
			labels={model.labels}
			projects={model.projects}
			stats={model.stats}
			onCloseDialog={model.closeDialog}
			onEditProject={model.editProject}
			onNewProject={model.newProject}
		/>
	);
}
