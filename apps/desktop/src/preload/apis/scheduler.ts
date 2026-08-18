import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";
import { onIpcEvent } from "./helper.js";

const SCHEDULER_CHANNELS = {
	GET_TASKS: "vetta:scheduler:get-tasks",
	CREATE_TASK: "vetta:scheduler:create-task",
	UPDATE_TASK: "vetta:scheduler:update-task",
	DELETE_TASK: "vetta:scheduler:delete-task",
	TOGGLE_TASK: "vetta:scheduler:toggle-task",
	DISABLE_TASK: "vetta:scheduler:disable-task",
	GET_RECORDS: "vetta:scheduler:get-records",
	GET_RUNNING: "vetta:scheduler:get-running",
	GET_SESSION_PATHS: "vetta:scheduler:get-session-paths",
	DELETE_RECORD_BY_SESSION: "vetta:scheduler:delete-record-by-session",
	RUN_NOW: "vetta:scheduler:run-now",
	ABORT: "vetta:scheduler:abort",
	EVENT: "vetta:scheduler:event",
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
			getScheduledSessionPaths: () => ipc.invoke(SCHEDULER_CHANNELS.GET_SESSION_PATHS),
			deleteRecordsBySession: (sessionPath) => ipc.invoke(SCHEDULER_CHANNELS.DELETE_RECORD_BY_SESSION, sessionPath),
			runTaskNow: (id) => ipc.invoke(SCHEDULER_CHANNELS.RUN_NOW, id),
			abortTask: (id) => ipc.invoke(SCHEDULER_CHANNELS.ABORT, id),
			onTaskEvent: (handler) => onIpcEvent(ipc, SCHEDULER_CHANNELS.EVENT, handler),
		},
	};
}
