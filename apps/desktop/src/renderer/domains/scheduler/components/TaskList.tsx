import type { ScheduledTask } from "@shared/store/atoms";
import { useTaskListModel } from "../hooks/useTaskListModel";
import { TaskListView } from "./TaskListView";

interface TaskListProps {
	selectedTaskId: string | null;
	onSelectTask: (id: string) => void;
	onEditTask: (task: ScheduledTask) => void;
}

export function TaskList({ selectedTaskId, onSelectTask, onEditTask }: TaskListProps): JSX.Element {
	const model = useTaskListModel({ selectedTaskId });
	return (
		<TaskListView
			items={model.items}
			labels={model.labels}
			onDeleteTask={model.onDeleteTask}
			onEditTask={(taskId) => {
				const item = model.items.find((candidate) => candidate.id === taskId);
				if (item) onEditTask(item.task);
			}}
			onRunTask={model.onRunTask}
			onSelectTask={onSelectTask}
			onToggleTask={model.onToggleTask}
		/>
	);
}
