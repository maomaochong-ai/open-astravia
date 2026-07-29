import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import electronUpdater from "electron-updater";

import { mainT } from "./i18n/index.js";
import { ElectronUpdaterEngine } from "./updater-engine.js";
import { type UpdateCheckResult, type UpdaterPhase, UpdaterService, type UpdaterState } from "./updater-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type { UpdateCheckResult, UpdaterPhase, UpdaterState };

export function getAppVersion(): string {
	return app.isPackaged
		? app.getVersion()
		: (JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8")).version as string);
}

// electron-updater 是 CommonJS 包；主进程产物为 ESM 且将它 externalize，
// 因此必须从默认导出解构，不能保留 ESM 命名导入。
const { autoUpdater } = electronUpdater;
const updaterEngine = new ElectronUpdaterEngine(autoUpdater);
export const updaterService = new UpdaterService(updaterEngine, getAppVersion(), app.isPackaged, mainT);

/** 兼容旧调用方：底层检查已切换为 electron-updater。 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
	const state = await updaterService.check();
	return {
		hasUpdate: state.phase === "available" || state.phase === "downloading" || state.phase === "ready",
		currentVersion: state.currentVersion,
		latestVersion: state.latestVersion,
		releaseNote: state.releaseNote,
		downloadUrl: updaterService.getDownloadUrl(),
		error: state.error,
	};
}
