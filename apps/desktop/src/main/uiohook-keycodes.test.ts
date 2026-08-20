// 守卫：主线程用的键码常量副本必须与 uiohook-napi 的 UiohookKey 完全一致。
//
// 主线程刻意不 import uiohook-napi（加载原生 addon 会注册 env cleanup hook，退出时
// 对 worker 的失效 CFRunLoopRef 调 hook_stop() → SIGTRAP），代价是这份副本可能随
// 上游升级漂移。本测试是唯一允许加载 addon 的地方（只读常量，不 start()）。

import { UiohookKey } from "uiohook-napi";
import { describe, expect, it } from "vitest";
import { UIOHOOK_KEYCODE } from "./uiohook-keycodes.js";

describe("UIOHOOK_KEYCODE", () => {
	it("与 uiohook-napi 的 UiohookKey 数值一致", () => {
		for (const [name, code] of Object.entries(UIOHOOK_KEYCODE)) {
			expect(code, name).toBe(UiohookKey[name as keyof typeof UiohookKey]);
		}
	});
});
