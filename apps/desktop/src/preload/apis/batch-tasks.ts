import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";
import { onIpcEvent } from "./helper.js";

const BATCH_TASKS_CHANNELS = {
	GET_PROJECTS: "astravia:batch-tasks:get-projects",
	CREATE_PROJECT: "astravia:batch-tasks:create-project",
	UPDATE_PROJECT: "astravia:batch-tasks:update-project",
	DELETE_PROJECT: "astravia:batch-tasks:delete-project",
	RUN_TASK: "astravia:batch-tasks:run-task",
	RETRY_TASK: "astravia:batch-tasks:retry-task",
	STOP_TASK: "astravia:batch-tasks:stop-task",
	DELETE_TASK: "astravia:batch-tasks:delete-task",
	BATCH_DELETE: "astravia:batch-tasks:batch-delete",
	BATCH_START: "astravia:batch-tasks:batch-start",
	BATCH_STOP: "astravia:batch-tasks:batch-stop",
	BATCH_RESET: "astravia:batch-tasks:batch-reset",
	BATCH_RESET_FAILED: "astravia:batch-tasks:batch-reset-failed",
	DELETE_SESSION: "astravia:batch-tasks:delete-session",
	RESUME_TASK: "astravia:batch-tasks:resume-task",
	RESUME_TASK_WITH_TEXT: "astravia:batch-tasks:resume-task-with-text",
	EVENT: "astravia:batch-tasks:event",
} as const;

export function createBatchTasksApi(ipc: IpcRenderer): Pick<DesktopApi, "batchTasks"> {
	return {
		batchTasks: {
			getProjects: () => ipc.invoke(BATCH_TASKS_CHANNELS.GET_PROJECTS),
			createProject: (data) => ipc.invoke(BATCH_TASKS_CHANNELS.CREATE_PROJECT, data),
			updateProject: (projectId, data) => ipc.invoke(BATCH_TASKS_CHANNELS.UPDATE_PROJECT, projectId, data),
			deleteProject: (projectId) => ipc.invoke(BATCH_TASKS_CHANNELS.DELETE_PROJECT, projectId),
			runTask: (projectId, taskId) => ipc.invoke(BATCH_TASKS_CHANNELS.RUN_TASK, projectId, taskId),
			retryTask: (projectId, taskId) => ipc.invoke(BATCH_TASKS_CHANNELS.RETRY_TASK, projectId, taskId),
			stopTask: (projectId, taskId) => ipc.invoke(BATCH_TASKS_CHANNELS.STOP_TASK, projectId, taskId),
			deleteTask: (projectId, taskId) => ipc.invoke(BATCH_TASKS_CHANNELS.DELETE_TASK, projectId, taskId),
			batchDelete: (projectId) => ipc.invoke(BATCH_TASKS_CHANNELS.BATCH_DELETE, projectId),
			batchStart: (projectId) => ipc.invoke(BATCH_TASKS_CHANNELS.BATCH_START, projectId),
			batchStop: (projectId) => ipc.invoke(BATCH_TASKS_CHANNELS.BATCH_STOP, projectId),
			batchReset: (projectId) => ipc.invoke(BATCH_TASKS_CHANNELS.BATCH_RESET, projectId),
			batchResetFailed: (projectId, taskIds) =>
				ipc.invoke(BATCH_TASKS_CHANNELS.BATCH_RESET_FAILED, projectId, taskIds),
			deleteSession: (sessionPath) => ipc.invoke(BATCH_TASKS_CHANNELS.DELETE_SESSION, sessionPath),
			resumeTask: (projectId, taskId) => ipc.invoke(BATCH_TASKS_CHANNELS.RESUME_TASK, projectId, taskId),
			resumeTaskWithText: (projectId, taskId, text) =>
				ipc.invoke(BATCH_TASKS_CHANNELS.RESUME_TASK_WITH_TEXT, projectId, taskId, text),
			onTaskEvent: (handler) => onIpcEvent(ipc, BATCH_TASKS_CHANNELS.EVENT, handler),
		},
	};
}
