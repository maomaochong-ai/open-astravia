import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, autoUpdater as nativeAutoUpdater } from "electron";
import electronUpdater from "electron-updater";

import { mainT } from "./i18n/index.js";
import {
	InnoWindowsUpdateController,
	isVersionedWindowsExecutable,
	resolveInnoUpdateStoreRoot,
} from "./inno-windows-update.js";
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
const innoWindowsUpdate =
	process.platform === "win32" && app.isPackaged && isVersionedWindowsExecutable(process.execPath, currentVersion)
		? new InnoWindowsUpdateController({
				currentVersion,
				storeRoot: resolveInnoUpdateStoreRoot(),
				relaunch: (executablePath) => {
					app.relaunch({ execPath: executablePath, args: process.argv.slice(1) });
				},
				quit: () => app.quit(),
			})
		: undefined;
const nativeMacUpdateEvents =
	process.platform === "darwin"
		? {
				onUpdateDownloaded: (listener: () => void) => {
					nativeAutoUpdater.on("update-downloaded", listener);
					return () => nativeAutoUpdater.off("update-downloaded", listener);
				},
				onError: (listener: (error: Error) => void) => {
					nativeAutoUpdater.on("error", listener);
					return () => nativeAutoUpdater.off("error", listener);
				},
			}
		: undefined;
// 与托盘「退出」菜单用同一个标记：窗口的 close 守卫只有看到它才会真正销毁窗口，
// 否则 macOS 上的关闭一律被改成隐藏，Squirrel.Mac 的终止流程会被整个取消。
const markAppQuitting = () => {
	(app as typeof app & { isQuitting?: boolean }).isQuitting = true;
};
const updaterEngine = new ElectronUpdaterEngine(autoUpdater, innoWindowsUpdate, nativeMacUpdateEvents, markAppQuitting);
export const updaterService = new UpdaterService(updaterEngine, currentVersion, app.isPackaged, mainT);
