/**
 * 应用图标：id 持久化在 desktop-config 的 `appIconId`。设置页经 `setAppIconId` 进来，
 * 启动时 `applyAppIcon` 套用一次。
 *
 * 运行时只能换 Dock / 窗口图标；访达里 `.app` 文件的图标与安装包图标由打包决定，这里改不了。
 */

import { join } from "node:path";
import { app, BrowserWindow, type NativeImage, nativeImage } from "electron";
import { APP_ICON_DEFAULT, type AppIconId, normalizeAppIconId } from "../../shared/app-icon.js";
import { readAppIconIdSync, updateDesktopConfig } from "../config/desktop-config-store.js";

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
	// Dock 不会给 setIcon 的图片加遮罩，macOS 用自带超椭圆与边距的 -mac 版本，其余平台用全幅方形。
	const suffix = process.platform === "darwin" ? "-mac" : "";
	const image = nativeImage.createFromPath(join(buildDir, "app-icons", `${id}${suffix}.png`));
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
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.setIcon(image ?? fallback);
	}
}

/** 设置图标：立即生效、广播给所有窗口，再落盘。返回实际生效的 id。 */
export async function setAppIconId(value: unknown): Promise<AppIconId> {
	const next = normalizeAppIconId(value);
	if (next === getAppIconId()) return next;
	currentId = next;
	applyAppIcon();
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.webContents.send(APP_ICON_CHANGED_CHANNEL, next);
	}
	await updateDesktopConfig((config) => ({ ...config, appIconId: next }));
	return next;
}
