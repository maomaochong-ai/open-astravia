import type { RuntimeStatus, RuntimesStatus, RuntimeType } from "../../main/runtimes/types.js";

export interface DesktopShellApi {
	showInFolder(fullPath: string): Promise<void>;
	showItemInFolder(fullPath: string): Promise<void>;
	openExternal(url: string): Promise<void>;
}

export interface DesktopClipboardApi {
	/**
	 * 把图片写入系统剪贴板。文本请直接用渲染进程的 navigator.clipboard.writeText；
	 * 图片走原生剪贴板，因为 ClipboardItem 的平台支持并不一致。
	 */
	writeImage(dataUrl: string): Promise<void>;
}

export interface DesktopWindowApi {
	minimize(): Promise<void>;
	maximize(): Promise<void>;
	close(): Promise<void>;
	isMaximized(): Promise<boolean>;
	onMaximizedChanged(handler: (isMaximized: boolean) => void): () => void;
	/** 切换窗口置顶，返回切换后的状态。 */
	toggleAlwaysOnTop(): Promise<boolean>;
	isAlwaysOnTop(): Promise<boolean>;
	/**
	 * 截取本窗口指定区域（DIP 坐标，如 getBoundingClientRect 所得）为 PNG，
	 * 经保存对话框落盘。返回保存路径，用户取消返回 null。
	 */
	captureRegion(
		rect: { x: number; y: number; width: number; height: number },
		defaultFileName: string,
	): Promise<string | null>;
}

export interface DesktopSettingsApi {
	getServerUrl(): Promise<string>;
	getSiteUrl(): Promise<string>;
	getServerToken(): Promise<string | undefined>;
	setServerToken(token: string | undefined): Promise<void>;
	getServerRefreshToken(): Promise<string | undefined>;
	setServerRefreshToken(token: string | undefined): Promise<void>;
}

/** 套餐配额窗口：5 小时 / 周 / 月三档。 */
export interface SubscriptionWindow {
	kind: "5h" | "week" | "month";
	limit: number;
	consumed: number;
	/** RFC3339 时间字符串，窗口重置时刻。 */
	reset_at: string;
}

/** GET /subscription/me 的业务数据（已 unwrap data）。 */
export interface SubscriptionStatus {
	active: boolean;
	go_enabled: boolean;
	tier_id?: string;
	tier_name?: string;
	badge_text?: string;
	badge_color?: string;
	description?: string;
	/** RFC3339 到期时间。 */
	expires_at?: string;
	windows?: SubscriptionWindow[];
}

export interface DesktopSubscriptionApi {
	/** 拉取当前用户的套餐状态。失败返回 status:null + error。 */
	getStatus(): Promise<{ status: SubscriptionStatus | null; error?: string }>;
}

export interface DesktopTrayApi {
	setQuitBehavior(hideToTray: boolean): Promise<void>;
	getQuitBehavior(): Promise<boolean>;
	setTooltip(text: string): Promise<void>;
}

// ─── Permissions (macOS) ───
export type PermissionKind = "full-disk-access" | "accessibility" | "notifications" | "screen-recording";
export type PermissionStatus = "granted" | "denied" | "unknown";
export interface PermissionsSnapshot {
	fullDiskAccess: PermissionStatus;
	accessibility: PermissionStatus;
	notifications: PermissionStatus;
	screenRecording: PermissionStatus;
}
export interface DesktopPermissionsApi {
	checkAll(): Promise<PermissionsSnapshot>;
	openPane(kind: PermissionKind): Promise<void>;
}

/** 托管运行时(环境管理面板)。见 ADR-0011。 */
export interface DesktopRuntimesApi {
	getStatus(): Promise<RuntimesStatus>;
	/** 强制重新获取(内置 vendor 拷贝,失败回退下载)推荐版本。 */
	reinstall(type: RuntimeType): Promise<RuntimeStatus>;
	/** 重新探测系统已装运行时。 */
	redetect(): Promise<RuntimesStatus>;
}
