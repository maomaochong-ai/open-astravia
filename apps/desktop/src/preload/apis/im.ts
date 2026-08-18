import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";
import { onIpcVoidEvent, subscribeById } from "./helper.js";

const IM_CHANNELS = {
	GET_CONFIG: "vetta:im:get-config",
	SET_CONFIG: "vetta:im:set-config",
	GET_STATUS: "vetta:im:get-status",
	SUBSCRIBE_STATUS: "vetta:im:subscribe-status",
	UNSUBSCRIBE_STATUS: "vetta:im:unsubscribe-status",
	STATUS_EVENT: "vetta:im:status-event",
	LOG_EVENT: "vetta:im:log-event",
	TEST_CONNECTION: "vetta:im:test-connection",
	RESTART: "vetta:im:restart",
	GET_RECENT_LOGS: "vetta:im:get-recent-logs",
	GET_PATHS: "vetta:im:get-paths",
	PROBE_AGENT_MODEL: "vetta:im:probe-agent-model",
	DETECT_LEGACY: "vetta:im:detect-legacy",
	IMPORT_LEGACY: "vetta:im:import-legacy",
	WECHAT_START_BIND: "vetta:im:wechat:start-bind",
	WECHAT_LOGOUT: "vetta:im:wechat:logout",
	WECHAT_SUBSCRIBE: "vetta:im:wechat:subscribe",
	WECHAT_UNSUBSCRIBE: "vetta:im:wechat:unsubscribe",
	WECHAT_BIND_EVENT: "vetta:im:wechat:bind-event",
	SESSION_CHANGED: "vetta:im:session-changed",
} as const;

export function createImApi(ipc: IpcRenderer): Pick<DesktopApi, "im"> {
	return {
		im: {
			getConfig: () => ipc.invoke(IM_CHANNELS.GET_CONFIG),
			setConfig: (payload) => ipc.invoke(IM_CHANNELS.SET_CONFIG, payload),
			getStatus: () => ipc.invoke(IM_CHANNELS.GET_STATUS),
			subscribeStatus: async (statusHandler, logHandler) => {
				let subscriptionId: string | undefined;
				type StatusSnap = Parameters<typeof statusHandler>[0];
				type LogSnap = Parameters<typeof logHandler>[0];
				const pendingStatus: Array<{ id: string; snap: StatusSnap }> = [];
				const pendingLog: Array<{ id: string; snap: LogSnap }> = [];
				const statusListener = (_event: Electron.IpcRendererEvent, incomingId: string, snapshot: unknown) => {
					const snap = snapshot as StatusSnap;
					if (subscriptionId === undefined) {
						pendingStatus.push({ id: incomingId, snap });
						return;
					}
					if (incomingId === subscriptionId) statusHandler(snap);
				};
				const logListener = (_event: Electron.IpcRendererEvent, incomingId: string, log: unknown) => {
					const snap = log as LogSnap;
					if (subscriptionId === undefined) {
						pendingLog.push({ id: incomingId, snap });
						return;
					}
					if (incomingId === subscriptionId) logHandler(snap);
				};
				ipc.on(IM_CHANNELS.STATUS_EVENT, statusListener);
				ipc.on(IM_CHANNELS.LOG_EVENT, logListener);
				const { subscriptionId: id } = (await ipc.invoke(IM_CHANNELS.SUBSCRIBE_STATUS)) as {
					subscriptionId: string;
				};
				subscriptionId = id;
				for (const { id: incomingId, snap } of pendingStatus) {
					if (incomingId === id) statusHandler(snap);
				}
				for (const { id: incomingId, snap } of pendingLog) {
					if (incomingId === id) logHandler(snap);
				}
				pendingStatus.length = 0;
				pendingLog.length = 0;
				return () => {
					ipc.removeListener(IM_CHANNELS.STATUS_EVENT, statusListener);
					ipc.removeListener(IM_CHANNELS.LOG_EVENT, logListener);
					void ipc.invoke(IM_CHANNELS.UNSUBSCRIBE_STATUS, id);
				};
			},
			testConnection: (payload) => ipc.invoke(IM_CHANNELS.TEST_CONNECTION, payload),
			restart: () => ipc.invoke(IM_CHANNELS.RESTART),
			getRecentLogs: () => ipc.invoke(IM_CHANNELS.GET_RECENT_LOGS),
			getPaths: () => ipc.invoke(IM_CHANNELS.GET_PATHS),
			probeAgentModel: (ref) => ipc.invoke(IM_CHANNELS.PROBE_AGENT_MODEL, ref),
			detectLegacy: () => ipc.invoke(IM_CHANNELS.DETECT_LEGACY),
			importLegacy: (detection) => ipc.invoke(IM_CHANNELS.IMPORT_LEGACY, detection),
			onSessionChanged: (handler) => onIpcVoidEvent(ipc, IM_CHANNELS.SESSION_CHANGED, handler),
			wechat: {
				startBind: () => ipc.invoke(IM_CHANNELS.WECHAT_START_BIND),
				logout: () => ipc.invoke(IM_CHANNELS.WECHAT_LOGOUT),
				subscribeBind: (handler) =>
					subscribeById(
						ipc,
						IM_CHANNELS.WECHAT_SUBSCRIBE,
						IM_CHANNELS.WECHAT_BIND_EVENT,
						IM_CHANNELS.WECHAT_UNSUBSCRIBE,
						handler,
						[],
					),
			},
		},
	};
}
