import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getVettaHomePath } from "@vetta/action-rpc";
import { app, autoUpdater as nativeAutoUpdater } from "electron";
import electronUpdater from "electron-updater";

import { mainT } from "./i18n/index.js";
import {
	InnoWindowsUpdateController,
	isVersionedWindowsExecutable,
	resolveInnoUpdateStoreRoot,
} from "./inno-windows-update.js";
import { handOffToInstaller, MACOS_SHIPIT_JOB_LABEL } from "./mac-installer-handoff.js";
import { runQuitCleanup } from "./quit-cleanup.js";
import { markPendingUpdateRelaunch } from "./update-relaunch-marker.js";
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
// 交棒前：标记 isQuitting（窗口 close 守卫只有看到它才真正销毁窗口），并跑完退出清理。
const prepareQuit = async () => {
	(app as typeof app & { isQuitting?: boolean }).isQuitting = true;
	// 安装器会以守护进程身份把应用拉回来，那样起来的窗口不会自动到前台，
	// 打个标记让下次启动主动抢焦点（见 update-relaunch-marker.ts）。
	markPendingUpdateRelaunch(getVettaHomePath());
	console.info("[updater] running quit cleanup before handing off to the installer");
	await runQuitCleanup();
};
// 交棒后：等 Squirrel 把 ShipIt 的 launchd 作业提交上去，再硬结束本进程——
// 本进程挂着 sidecar 等句柄不会自行退出，而 launchd 要等目标退出才 spawn ShipIt。
// 三种失败模式与取舍见 mac-installer-handoff.ts。
// 所有平台都必须走到最后的 app.exit(0)：before-quit 在清理跑过后是直通的，
// 不再兜底硬退出，而本进程挂着 IM sidecar、uiohook、RPC server 等句柄，
// Electron 的正常退出流程结束不了它。Windows 的 app.relaunch() 同样只在进程
// 真正退出后才生效，不 exit 就是「指针切了、新版本起不来」。
const finalizeQuit = async () => {
	if (process.platform === "darwin") {
		const result = await handOffToInstaller({ label: MACOS_SHIPIT_JOB_LABEL });
		console.info(`[updater] installer handoff: ${result}; exiting so the installer can replace the app`);
	}
	app.exit(0);
};
const updaterEngine = new ElectronUpdaterEngine(autoUpdater, innoWindowsUpdate, nativeMacUpdateEvents, {
	prepare: prepareQuit,
	finalize: finalizeQuit,
});
export const updaterService = new UpdaterService(updaterEngine, currentVersion, app.isPackaged, mainT);
