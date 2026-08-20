// uiohook 宿主 worker 线程（node:worker_threads 独立入口，见 vite.main.config.ts）。
//
// 为什么不在主线程跑：uiohook-napi ≤1.5.5 的 hook_enable() 存在启动竞态死锁：
// uv_cond_wait 无谓词循环，虚假唤醒后调用线程误判启动失败、持 hook_running_mutex 进入
// uv_thread_join；钩子线程随后派发 EVENT_HOOK_ENABLED 时又要锁同一把 mutex，两边永久互等。
// 死锁发生在原生层且卡住的是**调用线程**，因此把 uIOhook.start() 放到本 worker 线程：
// 真命中死锁时冻住的是 worker，Electron 主线程不会出现彩虹圈。
//
// 为什么不用 utilityProcess：实测在 Electron utilityProcess 里 uIOhook.start() 会正常
// 上报 started，但 CGEventTap 至多投递一个事件后就永久失聪——双击 ⌘ / 双 Shift 同按的
// 修饰键事件（macOS 的 flagsChanged）一个都收不到。同一台机器、同一时刻，主进程内的
// worker 线程可以完整收到全部事件，故宿主必须留在主进程内。
//
// 本文件除 uiohook-napi 外零依赖；键盘事件经 parentPort 单向上报，由主线程的
// UiohookSupervisor 消费（spawn / 看门狗 / 重试）。

import { parentPort } from "node:worker_threads";
import { uIOhook } from "uiohook-napi";
import type { UiohookHostMessage } from "./uiohook-protocol.js";

if (!parentPort) {
	// 不在 worker 线程上下文（被误当普通模块执行）时快速失败。
	console.error("[uiohook-worker] parentPort unavailable, not a worker thread");
	process.exit(1);
}

const port = parentPort;

function post(message: UiohookHostMessage): void {
	port.postMessage(message);
}

uIOhook.on("keydown", (e) => post({ type: "keydown", keycode: e.keycode }));
uIOhook.on("keyup", (e) => post({ type: "keyup", keycode: e.keycode }));

try {
	// 同步调用；若命中上游死锁则本 worker 线程整体挂起，收不到 "started" 的主线程会
	// terminate 并重拉。process.exit() 在 worker 中只结束当前线程，不影响主进程。
	uIOhook.start();
	post({ type: "started" });
} catch (err) {
	post({ type: "start-failed", message: err instanceof Error ? err.message : String(err) });
	process.exit(1);
}
