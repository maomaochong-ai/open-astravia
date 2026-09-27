import type { IpcRenderer } from "electron";
import { PLUGIN_CAPABILITY_CHANNELS } from "../../shared/plugin-capability-ipc.js";
import type { DesktopApi } from "../api.js";
import type { DesktopBrowserApi } from "../api-types/browser.js";

/**
 * preload 浏览器自动化 API 实现。
 *
 * renderer 调用 → IPC channel（PLUGIN_CAPABILITY_CHANNELS.BROWSER_*）
 *                → main/ipc/plugin-capabilities.ts handler
 *                → adapter.session() 解析 capability session id → pluginId 作 namespace
 *                → BrowserAutomationService。
 *
 * 所有方法第一参数 sessionId = plugin capability session id（不是 browser session id）。
 */

export function createBrowserApi(ipcRenderer: IpcRenderer): Pick<DesktopApi, "browser"> {
	const c = PLUGIN_CAPABILITY_CHANNELS;
	return {
		browser: {
			runtimeStatus(sessionId) {
				return ipcRenderer.invoke(c.BROWSER_RUNTIME_STATUS, sessionId);
			},
			installRuntime(sessionId, step) {
				return ipcRenderer.invoke(c.BROWSER_RUNTIME_INSTALL, sessionId, step);
			},
			createSession(sessionId, options) {
				return ipcRenderer.invoke(c.BROWSER_SESSION_CREATE, sessionId, options);
			},
			getSession(sessionId, browserSessionId) {
				return ipcRenderer.invoke(c.BROWSER_SESSION_GET, sessionId, browserSessionId);
			},
			navigate(sessionId, browserSessionId, url) {
				return ipcRenderer.invoke(c.BROWSER_NAVIGATE, sessionId, browserSessionId, url);
			},
			snapshot(sessionId, browserSessionId, options) {
				return ipcRenderer.invoke(c.BROWSER_SNAPSHOT, sessionId, browserSessionId, options);
			},
			readText(sessionId, browserSessionId, options) {
				return ipcRenderer.invoke(c.BROWSER_READ_TEXT, sessionId, browserSessionId, options);
			},
			screenshot(sessionId, browserSessionId, options) {
				return ipcRenderer.invoke(c.BROWSER_SCREENSHOT, sessionId, browserSessionId, options);
			},
			act(sessionId, browserSessionId, action, options) {
				return ipcRenderer.invoke(c.BROWSER_ACT, sessionId, browserSessionId, action, options);
			},
			closeSession(sessionId, browserSessionId) {
				return ipcRenderer.invoke(c.BROWSER_SESSION_CLOSE, sessionId, browserSessionId);
			},
		} satisfies DesktopBrowserApi,
	};
}
