import type { SessionHistoryInfo } from "@vetta/runtime-core";
import { ipcMain } from "electron";
import {
	QUICK_PANEL_CHANNELS,
	type QuickPanelConfigSnapshot,
	type QuickPanelSession,
} from "../../shared/quickpanel-ipc.js";
import { NOTIFICATION_NAVIGATE_CHANNEL } from "../notifications/notification-service.js";
import { stopQuickPanelTrigger } from "../quickpanel-trigger.js";
import { hideQuickPanelWindow } from "../quickpanel-window.js";
import { getSharedRuntime } from "../runtime.js";
import { getDesktopShortcutService, syncQuickPanelTrigger } from "../shortcuts/shortcut-service.js";
import { getMainWindow, showMainWindow } from "../window-manager.js";
import { DEFAULT_CONVERSATION_CWD, DEFAULT_CONVERSATION_SESSION_DIR } from "./fs.js";

export { syncQuickPanelTrigger } from "../shortcuts/shortcut-service.js";

const DEFAULT_RECENT_LIMIT = 8;

function toQuickPanelSession(session: SessionHistoryInfo): QuickPanelSession {
	const name = typeof session.name === "string" ? session.name.trim() : "";
	return {
		sessionPath: session.path,
		cwd: session.cwd,
		title: name || session.firstMessage || "",
		modifiedAt: session.modifiedAt,
		lastMessagePreview: session.lastMessagePreview ?? "",
	};
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Invalid ${field}`);
	}
}

function assertOpenTarget(value: unknown): asserts value is { sessionPath: string; cwd: string } {
	if (typeof value !== "object" || value === null) {
		throw new Error("Invalid open-session target");
	}
	const target = value as Record<string, unknown>;
	assertNonEmptyString(target.sessionPath, "sessionPath");
	assertNonEmptyString(target.cwd, "cwd");
}

export function registerQuickPanelIpc(): () => void {
	const runtime = getSharedRuntime();
	const shortcuts = getDesktopShortcutService();

	ipcMain.handle(QUICK_PANEL_CHANNELS.GET_CONFIG, async (): Promise<QuickPanelConfigSnapshot> => {
		return shortcuts.getQuickPanelSettings();
	});

	ipcMain.handle(QUICK_PANEL_CHANNELS.LIST_RECENT, async (_event, limit: unknown): Promise<QuickPanelSession[]> => {
		const max = typeof limit === "number" && Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_RECENT_LIMIT;
		const sessions = await runtime.listSessions(DEFAULT_CONVERSATION_CWD, DEFAULT_CONVERSATION_SESSION_DIR);
		// listSessions 已按 modifiedAt 倒序返回，仍显式排序以防实现变化。
		const sorted = [...sessions].sort((a, b) => b.modifiedAt - a.modifiedAt);
		return sorted.slice(0, max).map(toQuickPanelSession);
	});

	ipcMain.handle(QUICK_PANEL_CHANNELS.CREATE_CONVERSATION, async (_event, text: unknown): Promise<void> => {
		assertNonEmptyString(text, "text");
		const snapshot = await shortcuts.getQuickPanelSettings();
		const foreground = snapshot.postSendBehavior !== "background";
		// 前台：聚焦并显示主窗，让用户看到流式输出；后台：不抢焦点，但仍需主窗承载创建+运行。
		let mainWindow = getMainWindow();
		if (foreground || !mainWindow) {
			mainWindow = showMainWindow();
		}
		if (!mainWindow.isDestroyed()) {
			mainWindow.webContents.send(QUICK_PANEL_CHANNELS.RUN_PROMPT, { text, foreground });
		}
		hideQuickPanelWindow();
	});

	ipcMain.handle(QUICK_PANEL_CHANNELS.OPEN_SESSION, async (_event, target: unknown): Promise<void> => {
		assertOpenTarget(target);
		const mainWindow = showMainWindow();
		if (!mainWindow.isDestroyed()) {
			// 复用通知路由：把用户带到对应 session 的聊天页。
			mainWindow.webContents.send(NOTIFICATION_NAVIGATE_CHANNEL, {
				type: "agent-turn-complete",
				sessionPath: target.sessionPath,
				cwd: target.cwd,
			});
		}
		hideQuickPanelWindow();
	});

	ipcMain.handle(QUICK_PANEL_CHANNELS.HIDE, (): void => {
		hideQuickPanelWindow();
	});

	ipcMain.handle(QUICK_PANEL_CHANNELS.RELOAD_HOTKEY, async (): Promise<void> => {
		await syncQuickPanelTrigger();
	});

	return () => {
		ipcMain.removeHandler(QUICK_PANEL_CHANNELS.GET_CONFIG);
		ipcMain.removeHandler(QUICK_PANEL_CHANNELS.LIST_RECENT);
		ipcMain.removeHandler(QUICK_PANEL_CHANNELS.CREATE_CONVERSATION);
		ipcMain.removeHandler(QUICK_PANEL_CHANNELS.OPEN_SESSION);
		ipcMain.removeHandler(QUICK_PANEL_CHANNELS.HIDE);
		ipcMain.removeHandler(QUICK_PANEL_CHANNELS.RELOAD_HOTKEY);
		stopQuickPanelTrigger();
	};
}
