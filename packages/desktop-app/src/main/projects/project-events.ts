import { BrowserWindow } from "electron";
import { PROJECTS_CHANNELS } from "../../shared/projects-ipc.js";

/** 项目列表写入后通知全部存活窗口重读配置，使侧栏与磁盘状态一致。 */
export function broadcastProjectsChanged(): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (win.isDestroyed()) continue;
		win.webContents.send(PROJECTS_CHANNELS.CHANGED);
	}
}
