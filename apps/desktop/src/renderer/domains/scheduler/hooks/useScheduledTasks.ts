import { scheduledTasksAtom } from "@shared/store/atoms";
import { useAtom } from "jotai";
import { useCallback, useEffect } from "react";
import type { AutomationTaskInput, AutomationTaskPatch } from "../../../../shared/automation";

export function useScheduledTasks() {
	const [tasks, setTasks] = useAtom(scheduledTasksAtom);

	const refreshTasks = useCallback(async () => {
		const loaded = await window.vetta.scheduler.getTasks();
		setTasks(loaded);
	}, [setTasks]);

	useEffect(() => {
		return window.vetta.scheduler.onTaskEvent((event) => {
			if (event.type === "tasks.changed") {
				void refreshTasks();
			}
		});
	}, [refreshTasks]);

	const createTask = useCallback(
		async (data: AutomationTaskInput) => {
			const task = await window.vetta.scheduler.createTask(data);
			setTasks((prev) => [...prev, task]);
			return task;
		},
		[setTasks],
	);

	// 主进程会顺带清理暂停原因、重排作业，更新后以它的结果为准。
	const updateTask = useCallback(
		async (id: string, patch: AutomationTaskPatch) => {
			await window.vetta.scheduler.updateTask(id, patch);
			await refreshTasks();
		},
		[refreshTasks],
	);

	const deleteTask = useCallback(
		async (id: string) => {
			await window.vetta.scheduler.deleteTask(id);
			setTasks((current) => current.filter((task) => task.id !== id));
		},
		[setTasks],
	);

	const toggleTask = useCallback(
		async (id: string) => {
			await window.vetta.scheduler.toggleTask(id);
			await refreshTasks();
		},
		[refreshTasks],
	);

	const runNow = useCallback(async (id: string) => {
		await window.vetta.scheduler.runTaskNow(id);
	}, []);

	const abortTask = useCallback(async (id: string) => {
		await window.vetta.scheduler.abortTask(id);
	}, []);

	const getTask = useCallback((id: string) => tasks.find((t) => t.id === id), [tasks]);

	return {
		tasks,
		createTask,
		updateTask,
		deleteTask,
		toggleTask,
		runNow,
		abortTask,
		getTask,
		refreshTasks,
	};
}
