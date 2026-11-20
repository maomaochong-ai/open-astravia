// 主窗口的界面缩放。比例持久化在 desktop-config.uiZoomFactor，菜单快捷键与设置页
// 都经 setUiZoomFactor 进来，保证只有一个事实源。只作用于主窗口：快捷面板、桌宠等
// 辅助窗口以及 <webview> 内置浏览器保持各自的大小。

import { BrowserWindow, type WebContents } from "electron";
import {
	normalizeUiZoomFactor,
	parseTitlebarCenter,
	stepUiZoomFactor,
	TITLEBAR_CENTER_FALLBACK,
	trafficLightPositionFor,
	UI_ZOOM_DEFAULT,
} from "../../shared/ui-zoom.js";
import { readConfigSync, updateDesktopConfig } from "../config/desktop-config-store.js";

export const UI_ZOOM_CHANGED_CHANNEL = "astravia:ui-zoom:changed";
/** 快捷键触发的缩放：主窗口据此在右上角短暂提示当前档位（滑块拖动不触发）。 */
export const UI_ZOOM_HUD_CHANNEL = "astravia:ui-zoom:hud";

let currentFactor: number | undefined;
let mainContents: WebContents | undefined;
/** 渲染进程实测上报的页头中线（CSS px）；红绿灯位置的唯一来源。 */
let titlebarCenter = TITLEBAR_CENTER_FALLBACK;

export function getUiZoomFactor(): number {
	currentFactor ??= normalizeUiZoomFactor(readConfigSync().uiZoomFactor ?? UI_ZOOM_DEFAULT);
	return currentFactor;
}

/**
 * 把当前比例套到主窗口。Chromium 的缩放跟 origin 走，页面重新加载后可能回到它自己记的值，
 * 所以窗口创建与每次 did-finish-load 都要重新套一次。
 */
export function applyUiZoomToWebContents(webContents: WebContents): void {
	if (webContents.isDestroyed()) return;
	const factor = getUiZoomFactor();
	if (webContents.getZoomFactor() !== factor) webContents.setZoomFactor(factor);
	applyTrafficLightPosition(webContents, factor);
}

/**
 * 红绿灯是原生控件，不随网页缩放；页头中线却跟着比例走，所以比例变化时要把按钮挪到对应位置。
 * 全屏进出、还原、重新显示后系统可能把按钮放回默认位置，调用方在这些时机也要再套一次。
 */
function applyTrafficLightPosition(webContents: WebContents, factor: number): void {
	if (process.platform !== "darwin") return;
	const win = BrowserWindow.fromWebContents(webContents);
	if (!win || win.isDestroyed()) return;
	win.setWindowButtonPosition(trafficLightPositionFor(titlebarCenter, factor));
}

/** 登记主窗口的 webContents：此后比例变化会作用到它，页面加载完成时也会重新套用。 */
export function attachUiZoom(webContents: WebContents): void {
	mainContents = webContents;
	applyUiZoomToWebContents(webContents);
	webContents.on("did-finish-load", () => applyUiZoomToWebContents(webContents));
	const win = BrowserWindow.fromWebContents(webContents);
	const reapply = () => applyTrafficLightPosition(webContents, getUiZoomFactor());
	win?.on("leave-full-screen", reapply);
	win?.on("restore", reapply);
	win?.on("show", reapply);
}

/** 设置比例：夹取、立即生效、广播给所有窗口，再落盘。返回实际生效的比例。 */
export async function setUiZoomFactor(value: unknown): Promise<number> {
	const next = normalizeUiZoomFactor(value);
	if (next === getUiZoomFactor()) return next;
	currentFactor = next;
	if (mainContents) applyUiZoomToWebContents(mainContents);
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.webContents.send(UI_ZOOM_CHANGED_CHANNEL, next);
	}
	await updateDesktopConfig((config) => ({ ...config, uiZoomFactor: next }));
	return next;
}

/** 快捷键缩放后让主窗口提示当前档位；已到最大/最小档、比例没变时也提示，让用户知道到头了。 */
async function setUiZoomFromShortcut(value: number): Promise<number> {
	const applied = await setUiZoomFactor(value);
	if (mainContents && !mainContents.isDestroyed()) mainContents.send(UI_ZOOM_HUD_CHANNEL, applied);
	return applied;
}

export function stepUiZoom(direction: 1 | -1): Promise<number> {
	return setUiZoomFromShortcut(stepUiZoomFactor(getUiZoomFactor(), direction));
}

export function resetUiZoom(): Promise<number> {
	return setUiZoomFromShortcut(UI_ZOOM_DEFAULT);
}

/** 窗口创建时用：中线还没上报就是兜底值，上报后渲染进程会再校正。 */
export function getInitialTrafficLightPosition(): { x: number; y: number } {
	return trafficLightPositionFor(titlebarCenter, getUiZoomFactor());
}

/** 渲染进程上报页头图标的实测中线（CSS px），立刻把红绿灯对到同一水平线上。 */
export function setTitlebarCenter(value: unknown): void {
	const next = parseTitlebarCenter(value);
	if (next === undefined || next === titlebarCenter) return;
	titlebarCenter = next;
	if (mainContents && !mainContents.isDestroyed()) applyTrafficLightPosition(mainContents, getUiZoomFactor());
}
