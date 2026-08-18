import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";
import { onIpcEvent } from "./helper.js";

// 通道字符串以 src/shared/quickpanel-ipc.ts 为唯一来源。此处刻意内联字面量、不 import 该模块：
// 主 preload(index.ts) 与面板 preload(quickpanel.ts) 若都 import 同一模块，Rollup 会把它抽成
// 共享 chunk，而 Electron 以单文件加载 preload、无法解析同级 chunk，导致 window.vetta 整体加载失败。
const RELOAD_HOTKEY = "vetta:quickpanel:reload-hotkey";
const RUN_PROMPT = "vetta:quickpanel:run-prompt";

export function createQuickPanelApi(ipc: IpcRenderer): Pick<DesktopApi, "quickPanel"> {
	return {
		quickPanel: {
			reloadHotkey: () => ipc.invoke(RELOAD_HOTKEY),
			onRunPrompt: (handler) => onIpcEvent(ipc, RUN_PROMPT, handler),
		},
	};
}
