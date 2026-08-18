// Appshot（全局手势捕获前台应用窗口）主进程 <-> 渲染进程 IPC 契约。
// main 与 preload 的 api-types 引用此文件——通道字符串以此为唯一来源；
// 注意：preload 实现文件（apis/*）内必须内联字面量，不 import 本文件（见 preload/apis/quick-panel.ts 的坑）。

export const APPSHOT_CHANNELS = {
	/** settings → main invoke：配置变更后热重载手势监听 */
	RELOAD_GESTURE: "vetta:appshot:reload-gesture",
	/** main → 主窗口 renderer event：捕获完成，附件就绪 */
	CAPTURED: "vetta:appshot:captured",
	/** main → 主窗口 renderer event：捕获失败/被忽略 */
	CAPTURE_ERROR: "vetta:appshot:capture-error",
} as const;

export interface AppshotCapturedPayload {
	id: string; // 唯一 id（main 生成，如 `appshot-${Date.now()}`）
	appName: string; // 前台应用名
	windowTitle: string; // 窗口标题（可为空串）
	documentPath: string | null; // AXDocument 源文件路径
	imagePath: string | null; // 截图 PNG 绝对路径（无屏幕录制权限时 null）
	iconPath: string | null; // 前台应用图标 PNG 绝对路径（helper 未产出时 null）
	textPath: string | null; // AX 文本 md 绝对路径（抓不到 AX 文本时 null，仅带截图）
	capturedAt: number;
}

export type AppshotCaptureErrorReason = "self-capture" | "no-permission" | "helper-failed";
export interface AppshotCaptureErrorPayload {
	reason: AppshotCaptureErrorReason;
}
