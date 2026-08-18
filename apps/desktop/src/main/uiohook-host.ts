// uiohook 宿主子进程（Electron utilityProcess 独立入口，见 vite.main.config.ts）。
// uiohook-napi ≤1.5.5 的 hook_enable() 存在启动竞态死锁：uv_cond_wait 无谓词循环，
// 虚假唤醒后调用线程误判启动失败、持 hook_running_mutex 进入 uv_thread_join；钩子线程
// 随后派发 EVENT_HOOK_ENABLED 时又要锁同一把 mutex，两边永久互等。死锁发生在原生层，
// 调用方无法规避，因此把 uIOhook.start() 隔离到本子进程：卡死只冻结这里，主进程的
// UiohookSupervisor 看门狗超时后 kill 并重拉（竞态窗口极窄，重试大概率成功）。
// 本文件除 uiohook-napi 外零依赖；键盘事件经 parentPort 单向上报。

import { uIOhook } from "uiohook-napi";
import type { UiohookHostMessage } from "./uiohook-protocol.js";

const port = process.parentPort;
if (!port) {
	// 不在 utilityProcess 上下文（被误当普通脚本执行）时快速失败。
	console.error("[uiohook-host] process.parentPort unavailable, not a utilityProcess");
	process.exit(1);
}

function post(message: UiohookHostMessage): void {
	port.postMessage(message);
}

uIOhook.on("keydown", (e) => post({ type: "keydown", keycode: e.keycode }));
uIOhook.on("keyup", (e) => post({ type: "keyup", keycode: e.keycode }));

try {
	// 同步调用；若命中上游死锁则本进程整体挂起，收不到 "started" 的主进程会杀掉重拉。
	uIOhook.start();
	post({ type: "started" });
} catch (err) {
	post({ type: "start-failed", message: err instanceof Error ? err.message : String(err) });
	process.exit(1);
}
