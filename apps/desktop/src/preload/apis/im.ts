import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";
import { onIpcVoidEvent, subscribeById } from "./helper.js";

const IM_CHANNELS = {
	GET_CONFIG: "astravia:im:get-config",
	SET_CONFIG: "astravia:im:set-config",
	GET_STATUS: "astravia:im:get-status",
	SUBSCRIBE_STATUS: "astravia:im:subscribe-status",
	UNSUBSCRIBE_STATUS: "astravia:im:unsubscribe-status",
	STATUS_EVENT: "astravia:im:status-event",
	LOG_EVENT: "astravia:im:log-event",
	TEST_CONNECTION: "astravia:im:test-connection",
	RESTART: "astravia:im:restart",
	GET_RECENT_LOGS: "astravia:im:get-recent-logs",
	GET_PATHS: "astravia:im:get-paths",
	PROBE_AGENT_MODEL: "astravia:im:probe-agent-model",
	DETECT_LEGACY: "astravia:im:detect-legacy",
	IMPORT_LEGACY: "astravia:im:import-legacy",
	WECHAT_START_BIND: "astravia:im:wechat:start-bind",
	WECHAT_LOGOUT: "astravia:im:wechat:logout",
	WECHAT_SUBSCRIBE: "astravia:im:wechat:subscribe",
	WECHAT_UNSUBSCRIBE: "astravia:im:wechat:unsubscribe",
	WECHAT_BIND_EVENT: "astravia:im:wechat:bind-event",
	WHATSAPP_START_BIND: "astravia:im:whatsapp:start-bind",
	WHATSAPP_LOGOUT: "astravia:im:whatsapp:logout",
	WHATSAPP_SUBSCRIBE: "astravia:im:whatsapp:subscribe",
	WHATSAPP_UNSUBSCRIBE: "astravia:im:whatsapp:unsubscribe",
	WHATSAPP_BIND_EVENT: "astravia:im:whatsapp:bind-event",
	SIGNAL_START_BIND: "astravia:im:signal:start-bind",
	SIGNAL_LOGOUT: "astravia:im:signal:logout",
	SIGNAL_SUBSCRIBE: "astravia:im:signal:subscribe",
	SIGNAL_UNSUBSCRIBE: "astravia:im:signal:unsubscribe",
	SIGNAL_BIND_EVENT: "astravia:im:signal:bind-event",
	FEISHU_START_BIND: "astravia:im:feishu:start-bind",
	FEISHU_SUBSCRIBE: "astravia:im:feishu:subscribe",
	FEISHU_UNSUBSCRIBE: "astravia:im:feishu:unsubscribe",
	FEISHU_BIND_EVENT: "astravia:im:feishu:bind-event",
	CLEAR_CHANNEL: "astravia:im:clear-channel",
	SESSION_CHANGED: "astravia:im:session-changed",
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
			clearChannel: (transport) => ipc.invoke(IM_CHANNELS.CLEAR_CHANNEL, transport),
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
			whatsapp: {
				startBind: () => ipc.invoke(IM_CHANNELS.WHATSAPP_START_BIND),
				logout: () => ipc.invoke(IM_CHANNELS.WHATSAPP_LOGOUT),
				subscribeBind: (handler) =>
					subscribeById(
						ipc,
						IM_CHANNELS.WHATSAPP_SUBSCRIBE,
						IM_CHANNELS.WHATSAPP_BIND_EVENT,
						IM_CHANNELS.WHATSAPP_UNSUBSCRIBE,
						handler,
						[],
					),
			},
			feishu: {
				startBind: () => ipc.invoke(IM_CHANNELS.FEISHU_START_BIND),
				subscribeBind: (handler) =>
					subscribeById(
						ipc,
						IM_CHANNELS.FEISHU_SUBSCRIBE,
						IM_CHANNELS.FEISHU_BIND_EVENT,
						IM_CHANNELS.FEISHU_UNSUBSCRIBE,
						handler,
						[],
					),
			},
			signal: {
				startBind: () => ipc.invoke(IM_CHANNELS.SIGNAL_START_BIND),
				logout: () => ipc.invoke(IM_CHANNELS.SIGNAL_LOGOUT),
				subscribeBind: (handler) =>
					subscribeById(
						ipc,
						IM_CHANNELS.SIGNAL_SUBSCRIBE,
						IM_CHANNELS.SIGNAL_BIND_EVENT,
						IM_CHANNELS.SIGNAL_UNSUBSCRIBE,
						handler,
						[],
					),
			},
		},
	};
}
