import { type ScheduledTask, scheduledTasksAtom } from "@shared/store/atoms";
import { useAtom } from "jotai";
import { useCallback, useEffect } from "react";
import { CRON_PRESETS } from "./CRON_PRESETS";

export { CRON_PRESETS };

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
		async (data: Omit<ScheduledTask, "id" | "createdAt" | "updatedAt" | "lastRunAt" | "lastRunStatus">) => {
			const task = await window.vetta.scheduler.createTask(data);
			setTasks((prev) => [...prev, task]);

			return task;
		},
		[setTasks],
	);

	const updateTask = useCallback(
		async (id: string, patch: Partial<ScheduledTask>) => {
			await window.vetta.scheduler.updateTask(id, patch);
			setTasks((current) =>
				current.map((task) => (task.id === id ? { ...task, ...patch, updatedAt: Date.now() } : task)),
			);
		},
		[setTasks],
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
			setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, enabled: !t.enabled, updatedAt: Date.now() } : t)));
		},
		[setTasks],
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
		CRON_PRESETS,
	};
}
