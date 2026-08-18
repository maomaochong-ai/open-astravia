import type { BatchProject } from "@shared/store/atoms";
import { BatchTaskProjectHeaderView } from "@vetta/theme-ui/batch-tasks";
import type { ProjectCounts } from "../../hooks/useBatchTaskListModel";
import { useBatchTaskProjectHeaderModel } from "../../hooks/useBatchTaskProjectHeaderModel";

export function BatchTaskProjectHeader({
	counts,
	filteredTotal,
	normalizedQuery,
	onResetFailed,
	project,
}: {
	counts: ProjectCounts;
	filteredTotal: number;
	normalizedQuery: string;
	onResetFailed: () => void;
	project: BatchProject;
}): JSX.Element {
	const model = useBatchTaskProjectHeaderModel();

	return (
		<BatchTaskProjectHeaderView
			counts={counts}
			filteredTotal={filteredTotal}
			labels={model.labels}
			normalizedQuery={normalizedQuery}
			onResetFailed={onResetFailed}
			projectName={project.name}
		/>
	);
}
