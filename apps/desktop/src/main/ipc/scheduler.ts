import { ipcMain, type WebContents } from "electron";
import type { AutomationTaskEvent, AutomationTaskInput, AutomationTaskPatch } from "../../shared/automation.js";
import type { SchedulerService } from "../scheduler/scheduler-service.js";
import { getRunningTaskIds } from "../scheduler/task-executor.js";

const CHANNELS = {
	GET_TASKS: "vetta:scheduler:get-tasks",
	CREATE_TASK: "vetta:scheduler:create-task",
	UPDATE_TASK: "vetta:scheduler:update-task",
	DELETE_TASK: "vetta:scheduler:delete-task",
	TOGGLE_TASK: "vetta:scheduler:toggle-task",
	DISABLE_TASK: "vetta:scheduler:disable-task",
	GET_RECORDS: "vetta:scheduler:get-records",
	GET_RUNNING: "vetta:scheduler:get-running",
	GET_SESSION_LINKS: "vetta:scheduler:get-session-links",
	RUN_NOW: "vetta:scheduler:run-now",
	ABORT: "vetta:scheduler:abort",
	EVENT: "vetta:scheduler:event",
} as const;

export type TaskEvent = AutomationTaskEvent;

const eventHandlers = new Set<(event: TaskEvent) => void>();

export function emitTaskEvent(event: TaskEvent): void {
	for (const handler of eventHandlers) {
		handler(event);
	}
}

export function registerSchedulerIpc(webContents: WebContents, service: SchedulerService): () => void {
	const eventHandler = (event: TaskEvent) => {
		webContents.send(CHANNELS.EVENT, event);
	};
	eventHandlers.add(eventHandler);
	const unsubscribeTasksChanged = service.onTasksChanged(() => {
		emitTaskEvent({ type: "tasks.changed" });
	});

	ipcMain.handle(CHANNELS.GET_TASKS, async () => await service.listTasks());
	ipcMain.handle(CHANNELS.CREATE_TASK, async (_, task: AutomationTaskInput) => await service.createTask(task));
	ipcMain.handle(CHANNELS.UPDATE_TASK, async (_, id: string, patch: AutomationTaskPatch) => {
		await service.updateTask(id, patch);
	});
	ipcMain.handle(CHANNELS.DELETE_TASK, async (_, id: string) => {
		await service.deleteTask(id);
	});
	ipcMain.handle(CHANNELS.TOGGLE_TASK, async (_, id: string) => {
		await service.toggleTask(id);
	});
	ipcMain.handle(CHANNELS.DISABLE_TASK, async (_, id: string) => {
		await service.setEnabled(id, false);
	});
	ipcMain.handle(CHANNELS.GET_RECORDS, async (_, taskId: string) => await service.getHistory(taskId));
	ipcMain.handle(CHANNELS.GET_RUNNING, async () => getRunningTaskIds());
	ipcMain.handle(CHANNELS.GET_SESSION_LINKS, async () => await service.listSessionLinks());
	ipcMain.handle(CHANNELS.ABORT, async (_, taskId: string) => {
		await service.abort(taskId);
	});
	ipcMain.handle(CHANNELS.RUN_NOW, async (_, taskId: string) => {
		await service.runNow(taskId);
	});

	return () => {
		unsubscribeTasksChanged();
		eventHandlers.delete(eventHandler);
		for (const channel of Object.values(CHANNELS)) {
			if (channel !== CHANNELS.EVENT) ipcMain.removeHandler(channel);
		}
	};
}
