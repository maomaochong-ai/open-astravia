import { app, Menu, nativeImage, Tray } from "electron";
import { mainT } from "./i18n/index.js";
import { getAppLogger } from "./logger.js";
import { getMainWindow, iconPath, macTrayIconPath, showMainWindow } from "./window-manager.js";

const log = getAppLogger("tray");

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";

let tray: Tray | null = null;
let hideToTrayOnClose = true;

export function getHideToTrayOnClose(): boolean {
	return hideToTrayOnClose;
}

export function setHideToTrayOnClose(value: boolean): void {
	hideToTrayOnClose = value;
	rebuildTrayContextMenu();
}

export function getTray(): Tray | null {
	return tray;
}

function buildTrayMenu(): Electron.Menu {
	const mainWindow = getMainWindow();
	const isVisible = mainWindow?.isVisible() ?? false;
	const toggleItem = {
		label: isVisible ? mainT("tray.hideWindow") : mainT("tray.showWindow"),
		click: () => {
			const win = getMainWindow();
			if (!win) return;
			if (win.isVisible()) {
				win.hide();
			} else {
				showMainWindow();
			}
			rebuildTrayContextMenu();
		},
	};

	// Mac 不接入 hide-to-tray 分支（close 走 Electron 默认隐藏窗口、应用留 Dock），
	// 菜单只保留显示/隐藏 + 退出，避免暴露在 Mac 上无效的切换项。
	if (isMac) {
		return Menu.buildFromTemplate([
			toggleItem,
			{ type: "separator" },
			{
				label: mainT("tray.quitVetta"),
				click: () => {
					(app as typeof app & { isQuitting?: boolean }).isQuitting = true;
					if (tray) {
						tray.destroy();
						tray = null;
					}
					app.quit();
				},
			},
		]);
	}

	return Menu.buildFromTemplate([
		toggleItem,
		{
			label: hideToTrayOnClose ? mainT("tray.quit") : mainT("tray.hideToTray"),
			click: () => {
				(app as typeof app & { isQuitting?: boolean }).isQuitting = true;
				if (tray) {
					tray.destroy();
					tray = null;
				}
				app.quit();
			},
		},
	]);
}

function loadTrayIcon(): Electron.NativeImage {
	if (isMac) {
		const image = nativeImage.createFromPath(macTrayIconPath);
		if (image.isEmpty()) return image;
		return image.resize({ width: 22, height: 22 });
	}
	const icon = nativeImage.createFromPath(iconPath[process.platform]);
	if (icon.isEmpty()) return icon;
	return isWindows ? icon.resize({ width: 16, height: 16 }) : icon.resize({ width: 22, height: 22 });
}

export function createTray(): void {
	if (tray) return;

	const trayIcon = loadTrayIcon();
	log.debug(`Icon loaded: platform=${process.platform}, isEmpty=${trayIcon.isEmpty()}`);
	if (trayIcon.isEmpty()) {
		log.warn("Icon not found, skipping tray creation");
		return;
	}

	tray = new Tray(trayIcon);
	log.info("Created successfully");
	tray.setToolTip("Vetta");
	tray.setContextMenu(buildTrayMenu());

	// Mac 状态栏惯例：左/右键都由 setContextMenu 默认弹菜单，不另绑 click。
	// Win/Linux：左键切换主窗口显隐，右键走上下文菜单。
	if (!isMac) {
		tray.on("click", () => {
			const win = getMainWindow();
			if (!win) return;
			if (win.isVisible()) {
				win.hide();
			} else {
				showMainWindow();
			}
			rebuildTrayContextMenu();
		});
	}
}

export function rebuildTrayContextMenu(): void {
	if (!tray) return;
	tray.setContextMenu(buildTrayMenu());
}
