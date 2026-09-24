import type { IpcRenderer, IpcRendererEvent } from "electron";
import { SESSION_PINS_CHANGED_CHANNEL, type SessionPinsSnapshot } from "../../shared/session-pins.js";
import type { DesktopApi } from "../api.js";

const CHANNELS = {
	LIST: "vetta:session-pins:list",
	SET: "vetta:session-pins:set",
	FORGET: "vetta:session-pins:forget",
	IMPORT: "vetta:session-pins:import",
} as const;

export function createSessionPinsApi(ipc: IpcRenderer): Pick<DesktopApi, "sessionPins"> {
	return {
		sessionPins: {
			list: () => ipc.invoke(CHANNELS.LIST),
			set: (input) => ipc.invoke(CHANNELS.SET, input),
			forget: (paths) => ipc.invoke(CHANNELS.FORGET, [...paths]),
			importLegacy: (snapshot) => ipc.invoke(CHANNELS.IMPORT, snapshot),
			onChanged: (listener) => {
				const handler = (_event: IpcRendererEvent, snapshot: SessionPinsSnapshot): void => listener(snapshot);
				ipc.on(SESSION_PINS_CHANGED_CHANNEL, handler);
				return () => ipc.removeListener(SESSION_PINS_CHANGED_CHANNEL, handler);
			},
		},
	};
}
