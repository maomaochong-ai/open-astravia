import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ipcMain, Notification, shell } from "electron";
import { checkHelperPermissions } from "../appshot/appshot-service.js";

export type PermissionKind = "full-disk-access" | "accessibility" | "notifications" | "screen-recording";
export type PermissionStatus = "granted" | "denied" | "unknown";

interface PermissionsSnapshot {
	fullDiskAccess: PermissionStatus;
	accessibility: PermissionStatus;
	notifications: PermissionStatus;
	screenRecording: PermissionStatus;
}

const CHANNELS = {
	CHECK_ALL: "vetta:permissions:check-all",
	OPEN_PANE: "vetta:permissions:open-pane",
} as const;

// macOS 系统设置 → 隐私与安全 → 子面板的 URL Scheme
const PANE_URLS: Record<PermissionKind, string> = {
	"full-disk-access": "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
	accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
	notifications: "x-apple.systempreferences:com.apple.preference.notifications",
	"screen-recording": "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
};

// 受 TCC 保护的探测目标。优先选机器上一定存在的路径；
// 任一存在且能读 → 已授权；任一遇到 EACCES/EPERM → 未授权；全部 ENOENT → 未知。
const FDA_PROBE_PATHS = [
	// TCC 数据库本身一定存在、受 FDA 保护，最稳的探针
	join(homedir(), "Library", "Application Support", "com.apple.TCC", "TCC.db"),
	// 退路：Safari 书签（用过 Safari 的机器一定有）
	join(homedir(), "Library", "Safari", "Bookmarks.plist"),
	// 再退路：Mail 容器
	join(homedir(), "Library", "Mail"),
];

async function checkFullDiskAccess(): Promise<PermissionStatus> {
	let sawDenied = false;
	for (const probe of FDA_PROBE_PATHS) {
		try {
			await access(probe);
			return "granted";
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "EACCES" || code === "EPERM") {
				sawDenied = true;
			}
			// ENOENT 等：换下一个探针
		}
	}
	return sawDenied ? "denied" : "unknown";
}

// accessibility / screenRecording 现在查的是独立 TCC 主体「Vetta Computer Use」helper 的权限
// （非本 Electron 进程），单一来源为 appshot-service.ts 的 checkHelperPermissions。
async function checkHelperTccPermissions(): Promise<Pick<PermissionsSnapshot, "accessibility" | "screenRecording">> {
	const { accessibility, screenRecording } = await checkHelperPermissions();
	return {
		accessibility: accessibility ? "granted" : "denied",
		screenRecording: screenRecording ? "granted" : "denied",
	};
}

function checkNotifications(): PermissionStatus {
	// macOS 上 Electron 没有公开 API 查询通知授权状态（UNUserNotificationCenter 未暴露），
	// 只能判断「通知后端是否可用」。返回 unknown，由 UI 文案显式告知用户需手动确认。
	if (!Notification.isSupported()) return "denied";
	return "unknown";
}

async function snapshot(): Promise<PermissionsSnapshot> {
	if (process.platform !== "darwin") {
		return {
			fullDiskAccess: "unknown",
			accessibility: "unknown",
			notifications: "unknown",
			screenRecording: "unknown",
		};
	}
	const [fullDiskAccess, helperPermissions, notifications] = await Promise.all([
		checkFullDiskAccess(),
		checkHelperTccPermissions(),
		Promise.resolve(checkNotifications()),
	]);
	return { fullDiskAccess, notifications, ...helperPermissions };
}

export function registerPermissionsIpc(): () => void {
	ipcMain.handle(CHANNELS.CHECK_ALL, async () => snapshot());

	ipcMain.handle(CHANNELS.OPEN_PANE, async (_event, kind: unknown) => {
		if (process.platform !== "darwin") return;
		if (typeof kind !== "string" || !(kind in PANE_URLS)) {
			throw new Error(`Invalid permission kind: ${String(kind)}`);
		}
		await shell.openExternal(PANE_URLS[kind as PermissionKind]);
	});

	return () => {
		ipcMain.removeHandler(CHANNELS.CHECK_ALL);
		ipcMain.removeHandler(CHANNELS.OPEN_PANE);
	};
}
