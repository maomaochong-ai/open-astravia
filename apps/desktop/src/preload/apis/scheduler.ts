import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";
import { onIpcEvent } from "./helper.js";

const SCHEDULER_CHANNELS = {
	GET_TASKS: "astravia:scheduler:get-tasks",
	CREATE_TASK: "astravia:scheduler:create-task",
	UPDATE_TASK: "astravia:scheduler:update-task",
	DELETE_TASK: "astravia:scheduler:delete-task",
	TOGGLE_TASK: "astravia:scheduler:toggle-task",
	DISABLE_TASK: "astravia:scheduler:disable-task",
	GET_RECORDS: "astravia:scheduler:get-records",
	GET_RUNNING: "astravia:scheduler:get-running",
	GET_SESSION_LINKS: "astravia:scheduler:get-session-links",
	RUN_NOW: "astravia:scheduler:run-now",
	ABORT: "astravia:scheduler:abort",
	EVENT: "astravia:scheduler:event",
} as const;

export function createSchedulerApi(ipc: IpcRenderer): Pick<DesktopApi, "scheduler"> {
	return {
		scheduler: {
			getTasks: () => ipc.invoke(SCHEDULER_CHANNELS.GET_TASKS),
			createTask: (task) => ipc.invoke(SCHEDULER_CHANNELS.CREATE_TASK, task),
			updateTask: (id, patch) => ipc.invoke(SCHEDULER_CHANNELS.UPDATE_TASK, id, patch),
			deleteTask: (id) => ipc.invoke(SCHEDULER_CHANNELS.DELETE_TASK, id),
			toggleTask: (id) => ipc.invoke(SCHEDULER_CHANNELS.TOGGLE_TASK, id),
			disableTask: (id) => ipc.invoke(SCHEDULER_CHANNELS.DISABLE_TASK, id),
			getRecords: (taskId) => ipc.invoke(SCHEDULER_CHANNELS.GET_RECORDS, taskId),
			getRunningTaskIds: () => ipc.invoke(SCHEDULER_CHANNELS.GET_RUNNING),
			getSessionLinks: () => ipc.invoke(SCHEDULER_CHANNELS.GET_SESSION_LINKS),
			runTaskNow: (id) => ipc.invoke(SCHEDULER_CHANNELS.RUN_NOW, id),
			abortTask: (id) => ipc.invoke(SCHEDULER_CHANNELS.ABORT, id),
			onTaskEvent: (handler) => onIpcEvent(ipc, SCHEDULER_CHANNELS.EVENT, handler),
		},
	};
}
