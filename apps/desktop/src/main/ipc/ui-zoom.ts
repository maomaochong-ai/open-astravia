// 界面缩放的 IPC 边界：renderer 读取当前比例、设置新比例；变化由 service 广播。

import { ipcMain } from "electron";
import {
	getUiZoomFactor,
	resetUiZoom,
	setTitlebarCenter,
	setUiZoomFactor,
	stepUiZoom,
} from "../ui-zoom/ui-zoom-service.js";

export const UI_ZOOM_GET_CHANNEL = "astravia:ui-zoom:get";
export const UI_ZOOM_SET_CHANNEL = "astravia:ui-zoom:set";
export const UI_ZOOM_STEP_CHANNEL = "astravia:ui-zoom:step";
export const UI_ZOOM_RESET_CHANNEL = "astravia:ui-zoom:reset";
export const UI_ZOOM_TITLEBAR_CENTER_CHANNEL = "astravia:ui-zoom:titlebar-center";

export function registerUiZoomIpc(): () => void {
	ipcMain.handle(UI_ZOOM_GET_CHANNEL, () => getUiZoomFactor());
	ipcMain.handle(UI_ZOOM_SET_CHANNEL, (_event, raw: unknown) => setUiZoomFactor(raw));
	ipcMain.handle(UI_ZOOM_STEP_CHANNEL, (_event, raw: unknown) => stepUiZoom(raw === -1 ? -1 : 1));
	ipcMain.handle(UI_ZOOM_RESET_CHANNEL, () => resetUiZoom());
	ipcMain.on(UI_ZOOM_TITLEBAR_CENTER_CHANNEL, (_event, raw: unknown) => setTitlebarCenter(raw));
	return () => {
		ipcMain.removeHandler(UI_ZOOM_GET_CHANNEL);
		ipcMain.removeHandler(UI_ZOOM_SET_CHANNEL);
		ipcMain.removeHandler(UI_ZOOM_STEP_CHANNEL);
		ipcMain.removeHandler(UI_ZOOM_RESET_CHANNEL);
		ipcMain.removeAllListeners(UI_ZOOM_TITLEBAR_CENTER_CHANNEL);
	};
}
