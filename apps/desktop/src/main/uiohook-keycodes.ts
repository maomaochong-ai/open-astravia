// 主线程用到的 uiohook keycode 常量（uiohook-napi 的 UiohookKey 子集）。
//
// 为什么复制而不是从 uiohook-napi import：`require("uiohook-napi")` 顶层就会
// node-gyp-build 加载 .node，从而在**主线程的 Node Environment** 注册
// napi_add_env_cleanup_hook(AddonCleanUp)。该 hook 读的是进程级静态
// is_worker_running——它由 worker 线程里真正 start() 的那份 addon 置位，于是主线程
// 退出时会替 worker「代跑」uiohook_worker_stop()，对早已失效的 CFRunLoopRef 调
// CFRunLoopCopyCurrentMode，进程必然 SIGTRAP（macOS 弹「Vetta 意外退出」）。
// 主线程只需要几个键码常量，没有任何理由把原生 addon 载进来。
//
// 数值与 uiohook-napi 的一致性由 uiohook-keycodes.test.ts 锁定。

export const UIOHOOK_KEYCODE = {
	Ctrl: 0x001d,
	CtrlRight: 0x0e1d,
	Alt: 0x0038,
	AltRight: 0x0e38,
	Shift: 0x002a,
	ShiftRight: 0x0036,
	Meta: 0x0e5b,
	MetaRight: 0x0e5c,
} as const;
