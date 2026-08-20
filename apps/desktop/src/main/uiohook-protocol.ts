// uiohook 宿主 worker 线程 ↔ 主线程的消息合同。
// worker（uiohook-worker.ts）经 parentPort 上报键盘事件与启动结果；主线程只下发
// 一种控制消息 "stop"，用于让 worker 自己调用 uIOhook.stop() 后退出。
//
// 为什么必须有优雅 stop 而不能只靠 worker.terminate()：uiohook-napi 用
// napi_add_env_cleanup_hook 注册了 AddonCleanUp，它在 **任意** Node Environment
// 拆除时看到进程内的静态 is_worker_running 仍为 true，就会调用 uiohook_worker_stop()
// → darwin hook_stop() → CFRunLoopCopyCurrentMode(event_loop)。硬 terminate 之后
// 这个 CFRunLoopRef 已失效，退出时必然 SIGTRAP（macOS「意外退出」弹窗）或卡死在
// uv_thread_join。只有 worker 自己走完 uIOhook.stop() 才会把 is_worker_running 清零。

export type UiohookHostMessage =
	| { type: "started" }
	| { type: "start-failed"; message: string }
	| { type: "keydown"; keycode: number }
	| { type: "keyup"; keycode: number };

/** 主线程 → worker 的控制消息。 */
export type UiohookHostRequest = { type: "stop" };

/** 线程边界收窄：只放行结构合法的宿主消息，其余丢弃。 */
export function isUiohookHostMessage(value: unknown): value is UiohookHostMessage {
	if (typeof value !== "object" || value === null) return false;
	const message = value as Record<string, unknown>;
	switch (message.type) {
		case "started":
			return true;
		case "start-failed":
			return typeof message.message === "string";
		case "keydown":
		case "keyup":
			return typeof message.keycode === "number";
		default:
			return false;
	}
}

/** 线程边界收窄：worker 侧只处理结构合法的控制消息。 */
export function isUiohookHostRequest(value: unknown): value is UiohookHostRequest {
	if (typeof value !== "object" || value === null) return false;
	return (value as Record<string, unknown>).type === "stop";
}
