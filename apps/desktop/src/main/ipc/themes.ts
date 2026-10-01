import { BrowserWindow, ipcMain } from "electron";
import type { ThemeStorageChangedEvent, ThemeStorageJson } from "../../shared/theme-storage.js";
import { getDesktopCapabilityHost } from "../capabilities/capability-host.js";
import { listThemes } from "../themes/theme-store.js";

const CHANNELS = {
	LIST: "astravia:themes:list",
	STORAGE_GET_ALL: "astravia:themes:storage:get-all",
	STORAGE_SET: "astravia:themes:storage:set",
	STORAGE_REMOVE: "astravia:themes:storage:remove",
	STORAGE_CLEAR: "astravia:themes:storage:clear",
	STORAGE_CHANGED: "astravia:themes:storage:changed",
} as const;

function broadcastStorageChanged(themeId: string, data: Record<string, ThemeStorageJson>): void {
	const payload: ThemeStorageChangedEvent = { themeId, data };
	for (const win of BrowserWindow.getAllWindows()) {
		if (win.isDestroyed()) continue;
		win.webContents.send(CHANNELS.STORAGE_CHANGED, payload);
	}
}

export function registerThemesIpc(): () => void {
	const themeAdapter = getDesktopCapabilityHost().adapters.theme;
	ipcMain.handle(CHANNELS.LIST, () => listThemes());

	ipcMain.handle(CHANNELS.STORAGE_GET_ALL, async (_event, themeId: unknown) => {
		if (typeof themeId !== "string") throw new Error("themeId must be a string");
		return themeAdapter.getStorage(themeId);
	});

	ipcMain.handle(CHANNELS.STORAGE_SET, async (_event, themeId: unknown, key: unknown, value: unknown) => {
		if (typeof themeId !== "string") throw new Error("themeId must be a string");
		if (typeof key !== "string") throw new Error("key must be a string");
		const data = await themeAdapter.setStorage(themeId, key, value);
		broadcastStorageChanged(themeId, data);
		return data;
	});

	ipcMain.handle(CHANNELS.STORAGE_REMOVE, async (_event, themeId: unknown, key: unknown) => {
		if (typeof themeId !== "string") throw new Error("themeId must be a string");
		if (typeof key !== "string") throw new Error("key must be a string");
		const data = await themeAdapter.removeStorage(themeId, key);
		broadcastStorageChanged(themeId, data);
		return data;
	});

	ipcMain.handle(CHANNELS.STORAGE_CLEAR, async (_event, themeId: unknown) => {
		if (typeof themeId !== "string") throw new Error("themeId must be a string");
		const data = await themeAdapter.clearStorage(themeId);
		broadcastStorageChanged(themeId, data);
		return data;
	});

	return () => {
		ipcMain.removeHandler(CHANNELS.LIST);
		ipcMain.removeHandler(CHANNELS.STORAGE_GET_ALL);
		ipcMain.removeHandler(CHANNELS.STORAGE_SET);
		ipcMain.removeHandler(CHANNELS.STORAGE_REMOVE);
		ipcMain.removeHandler(CHANNELS.STORAGE_CLEAR);
	};
}
