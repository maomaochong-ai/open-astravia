import { ipcMain } from "electron";
import { APPSHOT_CHANNELS } from "../../shared/appshot-ipc.js";
import { captureAppshot } from "../appshot/appshot-service.js";
import { applyAppshotGesture, setAppshotGestureHandler } from "../quickpanel-trigger.js";
import { readDesktopConfig } from "./fs.js";

// ----- 双键同按手势生命周期 -----------------------------------------------
// 全局手势由 quickpanel-trigger.ts 的共享 uiohook 监听检测。
// 这里只负责把捕获回调挂上、并按配置启停。

let gestureHandlerBound = false;

/** 把「双键同按」回调挂到共享监听（仅一次）：触发即跑捕获主流程。 */
function ensureGestureHandler(): void {
	if (gestureHandlerBound) return;
	setAppshotGestureHandler(() => {
		void captureAppshot();
	});
	gestureHandlerBound = true;
}

/**
 * 依据最新配置启停 appshot 手势监听。启动配置就绪后调用一次；设置页保存后经 RELOAD_GESTURE 再次调用即可热切换。
 */
export async function syncAppshotGesture(): Promise<void> {
	ensureGestureHandler();
	const config = await readDesktopConfig();
	const enabled = config.appshot?.enabled === true;
	const gesture = config.appshot?.gesture ?? "both-shift";
	applyAppshotGesture(enabled ? gesture : "none");
}

export function registerAppshotIpc(): () => void {
	ipcMain.handle(APPSHOT_CHANNELS.RELOAD_GESTURE, async (): Promise<void> => {
		await syncAppshotGesture();
	});

	return () => {
		ipcMain.removeHandler(APPSHOT_CHANNELS.RELOAD_GESTURE);
		// 注销 appshot 消费者；quickpanel 消费者仍活跃时底层监听不停。
		applyAppshotGesture("none");
	};
}
