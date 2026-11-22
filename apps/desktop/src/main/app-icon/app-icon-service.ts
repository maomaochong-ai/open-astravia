/**
 * 应用图标：id 持久化在 desktop-config 的 `appIconId`。设置页经 `setAppIconId` 进来，
 * 启动时 `applyAppIcon` 套用一次。
 *
 * 运行时只能换 Dock / 窗口图标；访达里 `.app` 文件的图标与安装包图标由打包决定，这里改不了。
 */

import { basename, join } from "node:path";
import { app, BrowserWindow, type NativeImage, nativeImage } from "electron";
import { APP_ICON_DEFAULT, type AppIconId, appIconFileSuffix, normalizeAppIconId } from "../../shared/app-icon.js";
import { readAppIconIdSync, updateDesktopConfig } from "../config/desktop-config-store.js";
import { getAppLogger } from "../logger.js";
import { shortcutDirectories, syncWindowsShortcutIcons } from "./windows-shortcuts.js";

export const APP_ICON_CHANGED_CHANNEL = "astravia:app-icon:changed";

const buildDir = app.isPackaged ? join(process.resourcesPath, "build") : join(process.cwd(), "build");

let currentId: AppIconId | undefined;

export function getAppIconId(): AppIconId {
	currentId ??= normalizeAppIconId(readAppIconIdSync());
	return currentId;
}

/** 出厂图标走打包默认（Dock 用 icon-dock.png，自带 824 本体与边距），返回 undefined 表示「用默认」。 */
function appIconImage(id: AppIconId): NativeImage | undefined {
	if (id === APP_ICON_DEFAULT) return undefined;
	// Dock / 任务栏不会给 setIcon 的图片加遮罩，所以三套取景各自准备好：macOS 用带 8.6%
	// 边距的 `-mac` 贴 Apple 网格；Windows 用贴满画布的 `-win`，否则任务栏图标会比
	// 周围应用小一圈；Linux 桌面环境对圆角处理不一致，同样用贴满版。
	const image = nativeImage.createFromPath(join(buildDir, "app-icons", `${id}${appIconFileSuffix()}.png`));
	return image.isEmpty() ? undefined : image;
}

/** 非 macOS 的窗口图标：创建窗口时用，选了非默认图标才覆盖。 */
export function getWindowIconOverride(): NativeImage | undefined {
	return process.platform === "darwin" ? undefined : appIconImage(getAppIconId());
}

/** 把当前图标套到 Dock（macOS）与所有已开窗口（Windows / Linux）。 */
export function applyAppIcon(): void {
	const id = getAppIconId();
	const image = appIconImage(id);
	if (process.platform === "darwin") {
		app.dock?.setIcon(image ?? nativeImage.createFromPath(join(buildDir, "icon-dock.png")));
		return;
	}
	const fallback = nativeImage.createFromPath(join(buildDir, process.platform === "win32" ? "icon.ico" : "icon.png"));
	// Windows 任务栏图标最终回退到打包的 exe 图标；这里如果连 icon.ico 都加载成空，
	// 说明打包产物缺图标资源（`resources/build/icon.ico` 未落位），会显示 Electron 默认图标。
	if (fallback.isEmpty()) {
		getAppLogger("app-icon").warn("fallback window icon is empty", { platform: process.platform, buildDir });
	}
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.setIcon(image ?? fallback);
	}
}

/**
 * Windows 专用：把选中图标的 .ico 同步给固定项与桌面快捷方式。
 *
 * 失败只记日志：换图标不能因为某个快捷方式被占用而中断，用户下次切换会重试。
 */
async function syncWindowsShortcuts(id: AppIconId): Promise<void> {
	/*
	 * 只改「指向本安装包 exe」的快捷方式：开发态跑的是 electron.exe，而用户的任务栏固定
	 * 项指向已安装的 Astravia.exe。若不区分，在 dev 里换个图标就会静默改掉正式版的固定项
	 * 与桌面快捷方式——那不是用户点的那个应用的设置。
	 */
	const executables = app.isPackaged ? ["Astravia.exe"] : [basename(process.execPath)];
	try {
		await syncWindowsShortcutIcons({
			iconSourcePath: join(buildDir, "app-icon-icos", `${id}.ico`),
			userDataDir: app.getPath("userData"),
			appExecutables: executables,
			directories: shortcutDirectories(),
			log: (message) => getAppLogger("app-icon").info(message),
		});
	} catch (error) {
		getAppLogger("app-icon").warn("windows shortcut icon sync failed", { iconId: id, error: String(error) });
	}
}

/** 设置图标：立即生效、广播给所有窗口，再落盘。返回实际生效的 id。 */
export async function setAppIconId(value: unknown): Promise<AppIconId> {
	const next = normalizeAppIconId(value);
	if (next === getAppIconId()) return next;
	currentId = next;
	applyAppIcon();
	// 固定到任务栏的按钮与桌面快捷方式读的是快捷方式自己的 IconLocation，
	// setIcon 改了它们也不会跟着变，这里把选中图标落成稳定 .ico 再改写指向。
	if (process.platform === "win32") await syncWindowsShortcuts(next);
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.webContents.send(APP_ICON_CHANGED_CHANNEL, next);
	}
	await updateDesktopConfig((config) => ({ ...config, appIconId: next }));
	return next;
}
