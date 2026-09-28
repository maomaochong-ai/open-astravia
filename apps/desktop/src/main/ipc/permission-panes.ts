export type PermissionKind = "full-disk-access" | "accessibility" | "notifications" | "screen-recording";

// macOS 系统设置 → 隐私与安全 → 子面板的 URL Scheme
export const PANE_URLS: Record<PermissionKind, string> = {
	"full-disk-access": "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
	accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
	notifications: "x-apple.systempreferences:com.apple.preference.notifications",
	"screen-recording": "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
};
