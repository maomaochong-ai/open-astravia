import type { BatchProject, BatchTask, SessionExecutionMode } from "@shared/store/atoms";
import { BatchProjectGroupView } from "@vetta/theme-ui/batch-tasks";
import { useBatchProjectGroupModel } from "../hooks/useBatchProjectGroupModel";

interface BatchProjectGroupProps {
	project: BatchProject;
	tasks: BatchTask[];
	isExpanded: boolean;
	activeSessionPath?: string;
	onToggle: (projectId: string) => void;
	onSelectSession: (cwd: string, sessionPath: string, executionMode?: SessionExecutionMode) => void;
}

export function BatchProjectGroup({
	project,
	tasks,
	isExpanded,
	activeSessionPath,
	onToggle,
	onSelectSession,
}: BatchProjectGroupProps): JSX.Element {
	const model = useBatchProjectGroupModel({
		activeSessionPath,
		onSelectSession,
		project,
		tasks,
	});

	return (
		<BatchProjectGroupView
			isExpanded={isExpanded}
			labels={model.labels}
			onToggle={() => onToggle(project.id)}
			projectName={project.name}
			sessionCount={model.sessionCount}
			tasks={model.tasks}
		/>
	);
}
