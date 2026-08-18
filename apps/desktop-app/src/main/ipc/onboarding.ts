// Vetta Computer Use 授权引导窗 IPC：查/请求 helper 权限、拖拽授权、显示/关闭引导窗。
// OPEN_PANE 复用 permissions.ts 已注册的同名全局通道（vetta:permissions:open-pane），
// 本文件不重复注册该 handler。

import { existsSync } from "node:fs";
import { ipcMain, nativeImage } from "electron";
import { type HelperPermissions, ONBOARDING_CHANNELS } from "../../shared/onboarding-ipc.js";
import { checkHelperPermissions, requestHelperPermissions } from "../appshot/appshot-service.js";
import { resolveHelperAppBundlePath } from "../appshot/helper-resolver.js";
import { getAppLogger } from "../logger.js";
import { closeOnboardingWindow, getOnboardingWindow, showOnboardingWindow } from "../onboarding-window.js";
import { macTrayIconPath } from "../window-manager.js";

const log = getAppLogger("onboarding-ipc");

// 主窗口 → main：唤出引导窗。字面量与 preload/apis/appshot.ts 的 openOnboarding() 保持一致。
const SHOW_ONBOARDING_CHANNEL = "vetta:onboarding:show";

function sendPermissionsUpdated(perms: HelperPermissions): void {
	const win = getOnboardingWindow();
	if (win && !win.isDestroyed()) {
		win.webContents.send(ONBOARDING_CHANNELS.PERMISSIONS_UPDATED, perms);
	}
}

export function registerOnboardingIpc(): () => void {
	ipcMain.handle(ONBOARDING_CHANNELS.CHECK_PERMISSIONS, async (): Promise<HelperPermissions> => {
		const perms = await checkHelperPermissions();
		sendPermissionsUpdated(perms);
		return perms;
	});

	ipcMain.handle(ONBOARDING_CHANNELS.REQUEST_PERMISSIONS, async (): Promise<HelperPermissions> => {
		const perms = await requestHelperPermissions();
		sendPermissionsUpdated(perms);
		return perms;
	});

	// startDrag 须在 dragstart 事件的同一轮同步调用，走 send/on 而非 invoke/handle。
	ipcMain.on(ONBOARDING_CHANNELS.START_DRAG, (event) => {
		const file = resolveHelperAppBundlePath();
		if (!existsSync(file)) {
			log.error("start drag failed: helper app bundle not found", { file });
			if (!event.sender.isDestroyed()) event.sender.send(ONBOARDING_CHANNELS.DRAG_ERROR);
			return;
		}
		try {
			const icon = nativeImage.createFromPath(macTrayIconPath);
			event.sender.startDrag({ file, icon });
		} catch (err) {
			log.error("start drag failed", err);
			if (!event.sender.isDestroyed()) event.sender.send(ONBOARDING_CHANNELS.DRAG_ERROR);
		}
	});

	ipcMain.handle(ONBOARDING_CHANNELS.CLOSE, (): void => {
		closeOnboardingWindow();
	});

	ipcMain.handle(SHOW_ONBOARDING_CHANNEL, (): void => {
		showOnboardingWindow();
	});

	return () => {
		ipcMain.removeHandler(ONBOARDING_CHANNELS.CHECK_PERMISSIONS);
		ipcMain.removeHandler(ONBOARDING_CHANNELS.REQUEST_PERMISSIONS);
		ipcMain.removeAllListeners(ONBOARDING_CHANNELS.START_DRAG);
		ipcMain.removeHandler(ONBOARDING_CHANNELS.CLOSE);
		ipcMain.removeHandler(SHOW_ONBOARDING_CHANNEL);
	};
}
