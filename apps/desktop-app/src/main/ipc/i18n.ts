// 语言切换的 IPC 边界。
// - get-initial-language：同步通道（sendSync），供 renderer 在首帧前同步拿 {preference, language} 防闪。
// - set-language：renderer 触发 → 持久化 desktop-config → 切主进程语言 → 重建托盘菜单
//   → 广播 language-changed 给所有窗口（各 renderer 据此 i18n.changeLanguage）。

import { BrowserWindow, type IpcMainEvent, ipcMain } from "electron";
import { isLanguagePreference, type LanguagePreference, type LanguageState } from "../../shared/i18n/config.js";
import { applyLanguagePreference, getAppLanguage, getLanguagePreference, getLanguageState } from "../i18n/index.js";
import { rebuildTrayContextMenu } from "../tray-manager.js";
import { readDesktopConfig, writeDesktopConfig } from "./fs.js";

export const I18N_GET_INITIAL_CHANNEL = "vetta:i18n:get-initial-language";
export const I18N_SET_LANGUAGE_CHANNEL = "vetta:i18n:set-language";
export const I18N_LANGUAGE_CHANGED_CHANNEL = "vetta:i18n:language-changed";

function broadcastLanguageState(state: LanguageState): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.webContents.send(I18N_LANGUAGE_CHANGED_CHANNEL, state);
	}
}

/** 切换界面语言偏好并同步主进程 i18n、托盘菜单与全部 renderer。 */
export async function applyAppLanguage(preference: LanguagePreference): Promise<LanguageState> {
	const prev = getLanguageState();
	const next = applyLanguagePreference(preference);
	// 偏好与解析结果都未变则跳过写盘/广播（重复点选 system 时仍可能因 OS 变化而变 language）。
	if (prev.preference === next.preference && prev.language === next.language) {
		return next;
	}
	const config = await readDesktopConfig();
	await writeDesktopConfig({ ...config, language: preference });
	rebuildTrayContextMenu();
	broadcastLanguageState(next);
	return next;
}

export function registerI18nIpc(): () => void {
	// 同步返回当前偏好 + 解析语言。preload 在 contextBridge 暴露前 sendSync 取值，故必须在
	// 窗口创建前注册——本函数在 registerAllIpc 内调用，仍早于异步 page-load 触发 preload。
	const onGetInitial = (event: IpcMainEvent): void => {
		event.returnValue = getLanguageState();
	};
	ipcMain.on(I18N_GET_INITIAL_CHANNEL, onGetInitial);

	ipcMain.handle(I18N_SET_LANGUAGE_CHANNEL, async (_event, raw: unknown): Promise<LanguageState | undefined> => {
		if (!isLanguagePreference(raw)) return undefined;
		return applyAppLanguage(raw);
	});

	return () => {
		ipcMain.removeListener(I18N_GET_INITIAL_CHANNEL, onGetInitial);
		ipcMain.removeHandler(I18N_SET_LANGUAGE_CHANNEL);
	};
}

// 供其它 main 模块在不经 IPC 时复用（如未来系统 locale 变化钩子）。
export { getAppLanguage, getLanguagePreference, getLanguageState };
