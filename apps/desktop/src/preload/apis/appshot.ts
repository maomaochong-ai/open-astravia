import type { IpcRenderer } from "electron";
import type { DesktopApi } from "../api.js";
import { onIpcEvent } from "./helper.js";

// 通道字符串以 src/shared/appshot-ipc.ts 为唯一来源。此处刻意内联字面量、不 import 该模块：
// 主 preload(index.ts) 与面板 preload 若都 import 同一模块，Rollup 会把它抽成共享 chunk，
// 而 Electron 以单文件加载 preload、无法解析同级 chunk，导致 window.astravia 整体加载失败
// （同 apis/quick-panel.ts 的坑）。
const RELOAD_GESTURE = "astravia:appshot:reload-gesture";
const CAPTURED = "astravia:appshot:captured";
const CAPTURE_ERROR = "astravia:appshot:capture-error";
const ONBOARDING_SHOW = "astravia:onboarding:show";

export function createAppshotApi(ipc: IpcRenderer): Pick<DesktopApi, "appshot"> {
	return {
		appshot: {
			reloadGesture: () => ipc.invoke(RELOAD_GESTURE),
			openOnboarding: () => ipc.invoke(ONBOARDING_SHOW),
			onCaptured: (handler) => onIpcEvent(ipc, CAPTURED, handler),
			onCaptureError: (handler) => onIpcEvent(ipc, CAPTURE_ERROR, handler),
		},
	};
}
