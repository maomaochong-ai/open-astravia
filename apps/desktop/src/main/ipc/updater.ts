import { ipcMain } from "electron";
import { getAppVersion, updaterService } from "../updater.js";

export function registerUpdaterIpc(): () => void {
	ipcMain.handle("astravia:updater:check", async () => {
		return updaterService.check();
	});

	ipcMain.handle("astravia:updater:sync", async () => {
		await updaterService.syncInBackground();
	});

	ipcMain.handle("astravia:updater:get-state", () => {
		return updaterService.getState();
	});

	ipcMain.handle("astravia:updater:get-current-version", () => {
		return getAppVersion();
	});

	ipcMain.handle("astravia:updater:download", async () => {
		return updaterService.startDownload();
	});

	ipcMain.handle("astravia:updater:install", async () => {
		await updaterService.install();
	});

	ipcMain.handle("astravia:updater:dismiss", () => {
		updaterService.dismissReady();
	});

	ipcMain.handle("astravia:updater:cancel", () => {
		updaterService.cancel();
	});

	return () => {
		ipcMain.removeHandler("astravia:updater:check");
		ipcMain.removeHandler("astravia:updater:sync");
		ipcMain.removeHandler("astravia:updater:get-state");
		ipcMain.removeHandler("astravia:updater:get-current-version");
		ipcMain.removeHandler("astravia:updater:download");
		ipcMain.removeHandler("astravia:updater:install");
		ipcMain.removeHandler("astravia:updater:dismiss");
		ipcMain.removeHandler("astravia:updater:cancel");
	};
}
