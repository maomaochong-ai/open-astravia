import { useProjectActions } from "@domains/project/hooks/useProjects";
import { pathBasename } from "@shared/lib/utils";
import {
	batchProjectsAtom,
	batchQueuedTaskIdsAtom,
	type ExecutionModeOverride,
	expandedBatchProjectsAtom,
	type SelectedSkill,
} from "@shared/store/atoms";
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

export function useBatchTasks() {
	const { t } = useTranslation("batch-tasks");
	const [projects, setProjects] = useAtom(batchProjectsAtom);
	const [expandedProjects, setExpandedProjects] = useAtom(expandedBatchProjectsAtom);
	const setQueuedTaskIds = useSetAtom(batchQueuedTaskIdsAtom);
	// Batch project create/delete also mutates desktop-config.json (single
	// source of sidebar truth), so we must refresh the config-driven project
	// list whenever a batch CRUD lands.
	const { refreshProjects: refreshConfigProjects } = useProjectActions();

	const refreshProjects = useCallback(async () => {
		const loadedProjects = await window.vetta.batchTasks.getProjects();
		setProjects(loadedProjects);
	}, [setProjects]);

	const createProject = useCallback(
		async (data: {
			name: string;
			prompt: string;
			modelKey?: string;
			executionMode?: ExecutionModeOverride;
			folders: string[];
			concurrency: number;
			artifactPatterns?: string[];
			notifyEnabled?: boolean;
			timeoutMinutes?: number;
			skill?: SelectedSkill;
		}) => {
			const project = await window.vetta.batchTasks.createProject(data);
			setProjects((prev) => [...prev, project]);
			await refreshConfigProjects();
			return project;
		},
		[setProjects, refreshConfigProjects],
	);

	const updateProject = useCallback(
		async (
			projectId: string,
			data: {
				name?: string;
				prompt?: string;
				modelKey?: string;
				executionMode?: ExecutionModeOverride;
				concurrency?: number;
				artifactPatterns?: string[];
				notifyEnabled?: boolean;
				timeoutMinutes?: number;
				newFolders?: string[];
				skill?: SelectedSkill | null;
			},
		) => {
			await window.vetta.batchTasks.updateProject(projectId, data);
			setProjects((prev) =>
				prev.map((p) => {
					if (p.id !== projectId) return p;
					const newTasks = data.newFolders
						? data.newFolders
								.filter((sourcePath) => !p.tasks.some((t) => t.sourcePath === sourcePath))
								.map((sourcePath) => ({
									id: `batch-task-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
									name: pathBasename(sourcePath),
									cwd: sourcePath,
									sourcePath,
									status: "pending" as const,
									createdAt: Date.now(),
									updatedAt: Date.now(),
								}))
						: [];
					return {
						...p,
						...(data.name !== undefined ? { name: data.name } : {}),
						...(data.prompt !== undefined ? { prompt: data.prompt } : {}),
						...(data.modelKey !== undefined ? { modelKey: data.modelKey } : {}),
						...(data.executionMode !== undefined ? { executionMode: data.executionMode } : {}),
						...(data.concurrency !== undefined ? { concurrency: data.concurrency } : {}),
						...(data.artifactPatterns !== undefined ? { artifactPatterns: data.artifactPatterns } : {}),
						...(data.notifyEnabled !== undefined ? { notifyEnabled: data.notifyEnabled } : {}),
						...(data.timeoutMinutes !== undefined ? { timeoutMinutes: data.timeoutMinutes } : {}),
						...(data.skill !== undefined ? { skill: data.skill ?? undefined } : {}),
						tasks: [...p.tasks, ...newTasks],
						updatedAt: Date.now(),
					};
				}),
			);
		},
		[setProjects],
	);

	const deleteProject = useCallback(
		async (projectId: string) => {
			const project = projects.find((p) => p.id === projectId);
			if (project?.tasks.some((task) => task.status === "running")) {
				throw new Error(t("error.stopFirst"));
			}
			await window.vetta.batchTasks.deleteProject(projectId);
			setProjects((prev) => prev.filter((p) => p.id !== projectId));
			await refreshConfigProjects();
		},
		[projects, setProjects, refreshConfigProjects, t],
	);

	const toggleProject = useCallback(
		(projectId: string) => {
			setExpandedProjects((prev) => {
				const next = new Set(prev);
				if (next.has(projectId)) {
					next.delete(projectId);
				} else {
					next.add(projectId);
				}
				return next;
			});
		},
		[setExpandedProjects],
	);

	const runTask = useCallback(async (projectId: string, taskId: string) => {
		await window.vetta.batchTasks.runTask(projectId, taskId);
	}, []);

	const retryTask = useCallback(async (projectId: string, taskId: string) => {
		await window.vetta.batchTasks.retryTask(projectId, taskId);
	}, []);

	const stopTask = useCallback(async (projectId: string, taskId: string) => {
		await window.vetta.batchTasks.stopTask(projectId, taskId);
	}, []);

	const resumeTask = useCallback(async (projectId: string, taskId: string) => {
		await window.vetta.batchTasks.resumeTask(projectId, taskId);
	}, []);

	const resumeTaskWithText = useCallback(async (projectId: string, taskId: string, text: string) => {
		await window.vetta.batchTasks.resumeTaskWithText(projectId, taskId, text);
	}, []);

	const deleteTask = useCallback(
		async (projectId: string, taskId: string) => {
			await window.vetta.batchTasks.deleteTask(projectId, taskId);
			setProjects((prev) =>
				prev.map((p) =>
					p.id === projectId ? { ...p, tasks: p.tasks.filter((t) => t.id !== taskId), updatedAt: Date.now() } : p,
				),
			);
		},
		[setProjects],
	);

	const batchDelete = useCallback(
		async (projectId: string) => {
			await window.vetta.batchTasks.batchDelete(projectId);
			await refreshProjects();
		},
		[refreshProjects],
	);

	const deleteSession = useCallback(async (sessionPath: string) => {
		await window.vetta.batchTasks.deleteSession(sessionPath);
	}, []);

	const batchStart = useCallback(async (projectId: string) => {
		await window.vetta.batchTasks.batchStart(projectId);
	}, []);

	const batchStop = useCallback(async (projectId: string) => {
		await window.vetta.batchTasks.batchStop(projectId);
	}, []);

	const batchReset = useCallback(
		async (projectId: string) => {
			await window.vetta.batchTasks.batchReset(projectId);
			await refreshProjects();
		},
		[refreshProjects],
	);

	const batchResetFailed = useCallback(async (projectId: string, taskIds: string[]) => {
		await window.vetta.batchTasks.batchResetFailed(projectId, taskIds);
	}, []);

	useEffect(() => {
		const unsubscribe = window.vetta.batchTasks.onTaskEvent((event) => {
			console.log(`[BatchTaskRenderer] Event received: ${event.type}`, event);

			// 维护后端调度器排队中的 taskId 集合
			if (event.type === "task.queued") {
				setQueuedTaskIds((prev) => {
					if (prev.has(event.taskId)) return prev;
					const next = new Set(prev);
					next.add(event.taskId);
					return next;
				});
				return;
			}
			if (
				event.type === "task.dequeued" ||
				event.type === "task.started" ||
				event.type === "task.completed" ||
				event.type === "task.failed" ||
				event.type === "task.reset" ||
				event.type === "task.paused"
			) {
				setQueuedTaskIds((prev) => {
					if (!prev.has(event.taskId)) return prev;
					const next = new Set(prev);
					next.delete(event.taskId);
					return next;
				});
			}

			// task.dequeued 不改 BatchTask 状态本身（status 已是 pending），只清 queued 集合
			if (event.type === "task.dequeued") return;

			setProjects((prev) =>
				prev.map((p) => {
					if (p.id !== event.projectId) return p;
					return {
						...p,
						tasks: p.tasks.map((t) => {
							if (t.id !== event.taskId) return t;
							if (event.type === "task.started") {
								return {
									...t,
									status: "running" as const,
									sessionId: event.sessionId,
									sessionPath: event.sessionPath,
									executionMode: event.executionMode,
									updatedAt: Date.now(),
								};
							}
							if (event.type === "task.completed") {
								return { ...t, status: "completed" as const, updatedAt: Date.now() };
							}
							if (event.type === "task.failed") {
								return { ...t, status: "failed" as const, error: event.error };
							}
							if (event.type === "task.reset") {
								return {
									...t,
									status: "pending" as const,
									sessionId: undefined,
									sessionPath: undefined,
									error: undefined,
									updatedAt: Date.now(),
								};
							}
							if (event.type === "task.paused") {
								return {
									...t,
									status: "paused" as const,
									sessionId: event.sessionId,
									sessionPath: event.sessionPath,
									executionMode: event.executionMode,
									updatedAt: Date.now(),
								};
							}
							return t;
						}),
					};
				}),
			);
		});
		return unsubscribe;
	}, [setProjects, setQueuedTaskIds]);

	return {
		projects,
		expandedProjects,
		refreshProjects,
		createProject,
		updateProject,
		deleteProject,
		toggleProject,
		runTask,
		retryTask,
		stopTask,
		resumeTask,
		resumeTaskWithText,
		deleteTask,
		batchDelete,
		deleteSession,
		batchStart,
		batchStop,
		batchReset,
		batchResetFailed,
	};
}
