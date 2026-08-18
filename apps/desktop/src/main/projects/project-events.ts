import { BrowserWindow } from "electron";
import { PROJECTS_CHANNELS } from "../../shared/projects-ipc.js";

/**
 * 通知所有窗口项目列表变了。广播给全部窗口而不是只给主窗口：项目侧边栏在主窗口，
 * 但快捷面板等独立窗口同样会渲染项目列表，漏发就是又一处停在旧快照上的地方。
 */
export function broadcastProjectsChanged(): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
		win.webContents.send(PROJECTS_CHANNELS.CHANGED);
	}
}
