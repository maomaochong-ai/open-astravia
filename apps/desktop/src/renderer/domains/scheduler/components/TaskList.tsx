import { TaskListView } from "@vetta-org/theme-ui/scheduler";
import type { AutomationListFilter } from "../automation-status";
import { useTaskListModel } from "../hooks/useTaskListModel";

interface TaskListProps {
	selectedTaskId: string | null;
	filter: AutomationListFilter;
	search: string;
	onSelectTask: (id: string) => void;
}

export function TaskList({ selectedTaskId, filter, search, onSelectTask }: TaskListProps): JSX.Element {
	const model = useTaskListModel({ selectedTaskId, filter, search });
	return <TaskListView items={model.items} emptyLabel={model.emptyLabel} onSelectTask={onSelectTask} />;
}
