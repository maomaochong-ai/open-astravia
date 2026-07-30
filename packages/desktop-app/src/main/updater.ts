import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import electronUpdater from "electron-updater";

import { mainT } from "./i18n/index.js";
import {
	isVersionedWindowsExecutable,
	resolveStagedUpdateStoreRoot,
	resolveWindowsUpdateExtractorPath,
	StagedWindowsUpdateController,
} from "./staged-windows-update.js";
import { ElectronUpdaterEngine } from "./updater-engine.js";
import { type UpdaterPhase, UpdaterService, type UpdaterState } from "./updater-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type { UpdaterPhase, UpdaterState };

export function getAppVersion(): string {
	return app.isPackaged
		? app.getVersion()
		: (JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8")).version as string);
}

// electron-updater 是 CommonJS 包；主进程产物为 ESM 且将它 externalize，
// 因此必须从默认导出解构，不能保留 ESM 命名导入。
const { autoUpdater } = electronUpdater;
const currentVersion = getAppVersion();
const stagedWindowsUpdate =
	process.platform === "win32" && app.isPackaged && isVersionedWindowsExecutable(process.execPath, currentVersion)
		? new StagedWindowsUpdateController({
				currentVersion,
				storeRoot: resolveStagedUpdateStoreRoot(),
				extractorPath: resolveWindowsUpdateExtractorPath(process.resourcesPath),
				relaunch: (executablePath) => {
					app.relaunch({ execPath: executablePath, args: process.argv.slice(1) });
				},
				quit: () => app.quit(),
			})
		: undefined;
const updaterEngine = new ElectronUpdaterEngine(autoUpdater, stagedWindowsUpdate);
export const updaterService = new UpdaterService(updaterEngine, currentVersion, app.isPackaged, mainT);
