import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";
import { onIpcEvent } from "./helper.js";

const GET_CHANNEL = "astravia:ui-zoom:get";
const SET_CHANNEL = "astravia:ui-zoom:set";
const STEP_CHANNEL = "astravia:ui-zoom:step";
const RESET_CHANNEL = "astravia:ui-zoom:reset";
const TITLEBAR_CENTER_CHANNEL = "astravia:ui-zoom:titlebar-center";
const CHANGED_CHANNEL = "astravia:ui-zoom:changed";

export function createUiZoomApi(ipc: IpcRenderer): Pick<DesktopApi, "uiZoom"> {
	return {
		uiZoom: {
			get: () => ipc.invoke(GET_CHANNEL) as Promise<number>,
			set: (factor: number) => ipc.invoke(SET_CHANNEL, factor) as Promise<number>,
			step: (direction: 1 | -1) => ipc.invoke(STEP_CHANNEL, direction) as Promise<number>,
			reset: () => ipc.invoke(RESET_CHANNEL) as Promise<number>,
			reportTitlebarCenter: (centerCssPx: number) => ipc.send(TITLEBAR_CENTER_CHANNEL, centerCssPx),
			onChanged: (handler) => onIpcEvent<number>(ipc, CHANGED_CHANNEL, handler),
		},
	};
}
