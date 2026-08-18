import type { BatchTask } from "@shared/store/atoms";
import { BatchTaskGridView } from "@vetta/theme-ui/batch-tasks";
import { useMemo } from "react";
import { useBatchTaskGridModel } from "../../hooks/useBatchTaskGridModel";
import type { TaskCallbacks } from "./types";

export function BatchTaskGrid({
	callbacks,
	collapsed,
	countsTotal,
	filteredTotal,
	hiddenCount,
	normalizedQuery,
	onClearSearch,
	onSearchChange,
	onToggleExpanded,
	queuedTaskIds,
	searchQuery,
	visibleTasks,
}: {
	callbacks: TaskCallbacks;
	collapsed: boolean;
	countsTotal: number;
	filteredTotal: number;
	hiddenCount: number;
	normalizedQuery: string;
	onClearSearch: () => void;
	onSearchChange: (value: string) => void;
	onToggleExpanded: () => void;
	queuedTaskIds: Set<string>;
	searchQuery: string;
	visibleTasks: BatchTask[];
}): JSX.Element {
	const model = useBatchTaskGridModel(visibleTasks, queuedTaskIds);
	const taskById = useMemo(() => new Map(visibleTasks.map((task) => [task.id, task])), [visibleTasks]);

	return (
		<BatchTaskGridView
			callbacks={{
				delete: (taskId) => {
					const task = taskById.get(taskId);
					if (task) callbacks.delete(task);
				},
				goToSession: (taskId) => {
					const task = taskById.get(taskId);
					if (task) callbacks.goToSession(task);
				},
				resume: (taskId) => callbacks.resume(taskId),
				retry: (taskId) => {
					const task = taskById.get(taskId);
					if (task) callbacks.retry(task);
				},
				run: (taskId) => callbacks.run(taskId),
				stop: (taskId) => callbacks.stop(taskId),
			}}
			cardLabels={model.cardLabels}
			collapsed={collapsed}
			countsTotal={countsTotal}
			filteredTotal={filteredTotal}
			hiddenCount={hiddenCount}
			labels={model.labels}
			normalizedQuery={normalizedQuery}
			onClearSearch={onClearSearch}
			onSearchChange={onSearchChange}
			onToggleExpanded={onToggleExpanded}
			searchQuery={searchQuery}
			visibleTasks={model.visibleTasks}
		/>
	);
}
