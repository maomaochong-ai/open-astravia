import { app, ipcMain } from "electron";
import { currentReleaseNotePath, readCurrentReleaseNote } from "../current-release-note.js";
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

	ipcMain.handle("astravia:updater:get-current-release-note", () => {
		const options = {
			version: getAppVersion(),
			isPackaged: app.isPackaged,
			resourcesPath: process.resourcesPath,
			cwd: process.cwd(),
		};
		const note = readCurrentReleaseNote(options);
		if (!note) {
			// 缺文件时界面上只有「暂无这个版本的介绍」，看不出是版本号对不上还是没打包。
			console.warn("[updater] release note missing:", currentReleaseNotePath(options));
		}
		return note ?? null;
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
		ipcMain.removeHandler("astravia:updater:get-current-release-note");
		ipcMain.removeHandler("astravia:updater:download");
		ipcMain.removeHandler("astravia:updater:install");
		ipcMain.removeHandler("astravia:updater:dismiss");
		ipcMain.removeHandler("astravia:updater:cancel");
	};
}
