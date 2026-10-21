export type PermissionKind = "full-disk-access" | "accessibility" | "notifications" | "screen-recording";

// macOS 系统设置 → 隐私与安全 → 子面板的 URL Scheme
export const PANE_URLS: Record<PermissionKind, string> = {
	"full-disk-access": "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
	accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
	notifications: "x-apple.systempreferences:com.apple.preference.notifications",
	"screen-recording": "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
};

// 系统设置只为「已经发起过请求」的 TCC 主体列出隐私条目。把 helper 的两个服务标出来，
// 打开面板前先让 helper 请求一次，否则用户看到的列表里根本没有 Astravia Computer Use。
export const HELPER_REGISTERED_PANES: ReadonlySet<PermissionKind> = new Set<PermissionKind>([
	"accessibility",
	"screen-recording",
]);
