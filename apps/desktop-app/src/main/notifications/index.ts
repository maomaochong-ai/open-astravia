import { ipcMain, type WebContents } from "electron";
import {
	closeAllNotifications,
	NOTIFICATION_SET_FOREGROUND_CHANNEL,
	setForegroundSessionPath,
	setNotificationWebContents,
} from "./notification-service.js";

export type { AppNotification } from "./notification-service.js";
export { notify } from "./notification-service.js";

/**
 * 注册系统通知相关 IPC（见 ADR-0002）。检测「session 完成一轮」本身在
 * session.ts 的常驻订阅里做并直接调 notify()；这里只负责渲染端→主进程的
 * 「上报前台所在 session」通道，以及持有用于点击路由的 webContents。
 */
export function registerNotificationIpc(webContents: WebContents): () => void {
	setNotificationWebContents(webContents);
	ipcMain.handle(NOTIFICATION_SET_FOREGROUND_CHANNEL, (_event, sessionPath: unknown) => {
		setForegroundSessionPath(typeof sessionPath === "string" && sessionPath.length > 0 ? sessionPath : null);
	});
	return () => {
		ipcMain.removeHandler(NOTIFICATION_SET_FOREGROUND_CHANNEL);
		setNotificationWebContents(null);
		setForegroundSessionPath(null);
		closeAllNotifications();
	};
}
