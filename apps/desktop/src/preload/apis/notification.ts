import type { IpcRenderer } from "electron";
import { isBuiltinNotificationSoundId } from "../../shared/notification-preferences.js";
import type { DesktopApi } from "../api.js";
import { onIpcEvent } from "./helper.js";

const NOTIFICATION_CHANNELS = {
	SET_FOREGROUND: "vetta:notification:set-foreground-session",
	NAVIGATE: "vetta:notification:navigate",
	SOUND: "vetta:notification:sound",
} as const;

export function createNotificationApi(ipc: IpcRenderer): Pick<DesktopApi, "notification"> {
	return {
		notification: {
			setForegroundSession: (sessionPath) => ipc.invoke(NOTIFICATION_CHANNELS.SET_FOREGROUND, sessionPath),
			onNavigate: (handler) => onIpcEvent(ipc, NOTIFICATION_CHANNELS.NAVIGATE, handler),
			onSound: (handler) =>
				onIpcEvent(ipc, NOTIFICATION_CHANNELS.SOUND, (payload: unknown) => {
					if (typeof payload !== "object" || payload === null) return;
					const value = payload as { soundId?: unknown; volume?: unknown };
					if (!isBuiltinNotificationSoundId(value.soundId) || typeof value.volume !== "number") return;
					handler({ soundId: value.soundId, volume: Math.max(0, Math.min(100, value.volume)) });
				}),
		},
	};
}
