// Vetta Computer Use 授权引导窗：无边框、居中、置顶的实心背景小窗。
// 照抄 quickpanel-window.ts 的建窗骨架，但去掉液态玻璃与 blur 自动隐藏——
// 授权过程中用户需要切到「系统设置」，切走时不应自动关闭引导窗。

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, screen } from "electron";
import { getAppLogger } from "./logger.js";
import { iconPath } from "./window-manager.js";

const log = getAppLogger("onboarding-window");
const isMac = process.platform === "darwin";

const appRoot = app.isPackaged ? app.getAppPath() : process.cwd();
const resDir = app.isPackaged ? appRoot : join(appRoot, "dist");
const devServerUrl = process.env.VETTA_DESKTOP_DEV_URL;
const onboardingPreloadPath = join(resDir, "preload/onboarding.js");

const ONBOARDING_WIDTH = 440;
const ONBOARDING_HEIGHT = 480;

let onboardingWindow: BrowserWindow | null = null;

function getOnboardingEntryUrl(): string {
	if (devServerUrl) {
		return `${devServerUrl}/onboarding.html`;
	}
	return pathToFileURL(join(resDir, "renderer/onboarding.html")).toString();
}

function loadOnboardingEntry(win: BrowserWindow): void {
	const url = getOnboardingEntryUrl();
	log.info("load entry", { mode: devServerUrl ? "dev-server" : "file", devServerUrl, url });
	void win.loadURL(url).catch((error: unknown) => {
		log.error("loadURL failed", error);
	});
}

// 居中于光标所在显示器（与 quickpanel 一致的多屏策略）。
function centerOnboardingWindow(win: BrowserWindow): void {
	const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
	const { workArea } = display;
	const x = Math.round(workArea.x + (workArea.width - ONBOARDING_WIDTH) / 2);
	const y = Math.round(workArea.y + (workArea.height - ONBOARDING_HEIGHT) / 2);
	win.setBounds({ x, y, width: ONBOARDING_WIDTH, height: ONBOARDING_HEIGHT });
}

export function getOnboardingWindow(): BrowserWindow | null {
	return onboardingWindow;
}

export function createOnboardingWindow(): BrowserWindow {
	if (onboardingWindow && !onboardingWindow.isDestroyed()) {
		return onboardingWindow;
	}

	log.info("create requested", { isPackaged: app.isPackaged, appRoot, resDir, devServerUrl, onboardingPreloadPath });

	onboardingWindow = new BrowserWindow({
		width: ONBOARDING_WIDTH,
		height: ONBOARDING_HEIGHT,
		frame: false,
		transparent: false,
		resizable: false,
		movable: true,
		show: false,
		skipTaskbar: false,
		alwaysOnTop: true,
		fullscreenable: false,
		minimizable: false,
		maximizable: false,
		icon: iconPath[process.platform],
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: onboardingPreloadPath,
		},
	});

	onboardingWindow.setAlwaysOnTop(true, "floating");
	if (isMac) {
		onboardingWindow.setVisibleOnAllWorkspaces(true, {
			visibleOnFullScreen: true,
			skipTransformProcessType: true,
		});
	}
	onboardingWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	onboardingWindow.webContents.on("preload-error", (_event, preloadPathForError, error) => {
		log.error("preload-error", { preloadPath: preloadPathForError, error });
	});
	onboardingWindow.webContents.on(
		"did-fail-load",
		(_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
			log.error("did-fail-load", { errorCode, errorDescription, validatedURL, isMainFrame });
		},
	);
	// 注意：不注册 blur 自动隐藏——用户授权时会切到「系统设置」，切走不应关闭本窗。
	onboardingWindow.on("closed", () => {
		onboardingWindow = null;
		log.info("closed");
	});

	loadOnboardingEntry(onboardingWindow);
	return onboardingWindow;
}

export function showOnboardingWindow(): BrowserWindow {
	const win = onboardingWindow && !onboardingWindow.isDestroyed() ? onboardingWindow : createOnboardingWindow();
	centerOnboardingWindow(win);
	win.show();
	win.focus();
	log.info("show requested", { bounds: win.getBounds() });
	return win;
}

export function closeOnboardingWindow(): void {
	if (!onboardingWindow || onboardingWindow.isDestroyed()) return;
	onboardingWindow.close();
	log.info("close requested");
}
