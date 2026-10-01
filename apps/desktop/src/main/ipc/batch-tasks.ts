import { type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import { subscribeBatchTaskEvents } from "../batch-tasks/batch-task-executor.js";
import type {
	BatchTaskService,
	CreateBatchProjectInput,
	UpdateBatchProjectInput,
} from "../batch-tasks/batch-task-service.js";

const CHANNELS = {
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

export function registerBatchTasksIpc(
	webContents: WebContents,
	service: BatchTaskService,
	serviceReady: Promise<void>,
): () => void {
	const unsubscribeBatchEvents = subscribeBatchTaskEvents((event) => {
		webContents.send(CHANNELS.EVENT, event);
	});
	const afterReady = <TArgs extends unknown[], TResult>(
		handler: (...args: TArgs) => TResult | Promise<TResult>,
	): ((_event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult>) => {
		return async (_event, ...args) => {
			await serviceReady;
			return await handler(...args);
		};
	};

	ipcMain.handle(
		CHANNELS.GET_PROJECTS,
		afterReady(() => service.listProjects()),
	);
	ipcMain.handle(
		CHANNELS.CREATE_PROJECT,
		afterReady((data: CreateBatchProjectInput) => service.createProject(data)),
	);
	ipcMain.handle(
		CHANNELS.UPDATE_PROJECT,
		afterReady((projectId: string, data: UpdateBatchProjectInput) => service.updateProject(projectId, data)),
	);
	ipcMain.handle(
		CHANNELS.DELETE_PROJECT,
		afterReady((projectId: string) => service.deleteProject(projectId)),
	);
	ipcMain.handle(
		CHANNELS.RUN_TASK,
		afterReady((projectId: string, taskId: string) => service.runTask(projectId, taskId)),
	);
	ipcMain.handle(
		CHANNELS.RETRY_TASK,
		afterReady((projectId: string, taskId: string) => service.retryTask(projectId, taskId)),
	);
	ipcMain.handle(
		CHANNELS.STOP_TASK,
		afterReady((projectId: string, taskId: string) => service.stopTask(projectId, taskId)),
	);
	ipcMain.handle(
		CHANNELS.DELETE_TASK,
		afterReady((projectId: string, taskId: string) => service.deleteTask(projectId, taskId)),
	);
	ipcMain.handle(
		CHANNELS.BATCH_DELETE,
		afterReady((projectId: string) => service.deleteAllTasks(projectId)),
	);
	ipcMain.handle(
		CHANNELS.BATCH_START,
		afterReady((projectId: string) => service.startProject(projectId)),
	);
	ipcMain.handle(
		CHANNELS.BATCH_STOP,
		afterReady((projectId: string) => service.stopProject(projectId)),
	);
	ipcMain.handle(
		CHANNELS.BATCH_RESET,
		afterReady((projectId: string) => service.resetProject(projectId)),
	);
	ipcMain.handle(
		CHANNELS.BATCH_RESET_FAILED,
		afterReady((projectId: string, taskIds: string[]) => service.resetFailedTasks(projectId, taskIds)),
	);
	ipcMain.handle(
		CHANNELS.DELETE_SESSION,
		afterReady((sessionPath: string) => service.deleteSessionByPath(sessionPath)),
	);
	ipcMain.handle(
		CHANNELS.RESUME_TASK,
		afterReady((projectId: string, taskId: string) => service.resumeTask(projectId, taskId)),
	);
	ipcMain.handle(
		CHANNELS.RESUME_TASK_WITH_TEXT,
		afterReady((projectId: string, taskId: string, text: string) => service.resumeTask(projectId, taskId, text)),
	);

	return () => {
		unsubscribeBatchEvents();
		for (const channel of Object.values(CHANNELS)) {
			if (channel !== CHANNELS.EVENT) ipcMain.removeHandler(channel);
		}
	};
}
